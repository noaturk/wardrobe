import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sanitizeImage } from "../server/images.mjs";
import { editImageWithOpenAI } from "../server/openai-images.mjs";

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const STAGES = new Set(["crop", "garment", "modeled"]);
const DECISIONS = new Set(["approve", "reject"]);
const PARTS = new Set(["upperbody", "wholebody_up", "lowerbody", "onepiece", "accessories_up", "shoes"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

async function body(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Expected a JSON request body"), { status: 400 }); }
}

function publicJob(job) {
  const copy = structuredClone(job);
  delete copy.internal;
  return copy;
}

function extension(mime = "image/png") {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" })[mime] || "png";
}

async function decodeImage(input, options = {}) {
  const raw = input.imageDataUrl || input.imageBase64;
  if (!raw || typeof raw !== "string") throw Object.assign(new Error("imageDataUrl or imageBase64 is required"), { status: 400 });
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = match?.[1] || input.mimeType || "image/png";
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw Object.assign(new Error("Unsupported image type"), { status: 415 });
  const estimatedBytes = Math.ceil((match?.[2] || raw).length * 0.75);
  if (estimatedBytes > options.maxBytes) throw Object.assign(new Error("Image is larger than the configured upload limit"), { status: 413 });
  const data = Buffer.from(match?.[2] || raw, "base64");
  const sanitized = await sanitizeImage(data, options);
  return { data: sanitized.bytes, mime: sanitized.mime };
}

function normalizeMetadata(value = {}) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const color = typeof metadata.color === "string" && HEX_COLOR.test(metadata.color) ? metadata.color.toLowerCase() : "#d8d0c2";
  const secondaryColor = typeof metadata.secondaryColor === "string" && HEX_COLOR.test(metadata.secondaryColor) ? metadata.secondaryColor.toLowerCase() : null;
  return {
    name: typeof metadata.name === "string" ? metadata.name.trim().slice(0, 120) || "New piece" : "New piece",
    part: PARTS.has(metadata.part) ? metadata.part : "upperbody",
    subcategory: typeof metadata.subcategory === "string" ? metadata.subcategory.trim().slice(0, 60) : "",
    brand: typeof metadata.brand === "string" ? metadata.brand.trim().slice(0, 60) : "",
    color,
    secondaryColor,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
    boundingBox: normalizeBoundingBox(metadata.boundingBox),
  };
}

function normalizeBoundingBox(value = {}) {
  const box = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = (key, fallback) => Number.isFinite(Number(box[key])) ? Math.round(Number(box[key])) : fallback;
  const x = Math.max(0, Math.min(999, number("x", 0)));
  const y = Math.max(0, Math.min(999, number("y", 0)));
  const width = Math.max(1, Math.min(1000 - x, number("width", 1000 - x)));
  const height = Math.max(1, Math.min(1000 - y, number("height", 1000 - y)));
  return { x, y, width, height };
}

async function normalizeImage(bytes) {
  return sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
}

function responseRequestId(response) {
  return response.headers.get("x-request-id") || response.headers.get("openai-request-id") || null;
}

function responseRetryDelay(response, attempt, baseMs) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, Math.round(seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return Math.min(12_000, baseMs * (2 ** attempt));
}

async function readOpenAIError(response) {
  const text = await response.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; }
  catch { /* Gateways sometimes return an empty or HTML error page. */ }
  return {
    message: typeof parsed?.error?.message === "string" ? parsed.error.message : null,
    code: typeof parsed?.error?.code === "string" ? parsed.error.code : null,
    type: typeof parsed?.error?.type === "string" ? parsed.error.type : null,
    preview: parsed ? null : text.replace(/\s+/g, " ").trim().slice(0, 240) || null,
  };
}

async function cropDetectedItem(bytes, boundingBox) {
  const normalized = await normalizeImage(bytes);
  const { width, height } = await sharp(normalized).metadata();
  const box = normalizeBoundingBox(boundingBox);
  const rawLeft = (box.x / 1000) * width;
  const rawTop = (box.y / 1000) * height;
  const rawWidth = (box.width / 1000) * width;
  const rawHeight = (box.height / 1000) * height;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  return sharp(normalized).extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).png().toBuffer();
}

function chooseChromaKey(primary = "#808080") {
  const value = HEX_COLOR.test(primary) ? primary : "#808080";
  const source = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const candidates = [[0, 255, 0], [255, 0, 255], [0, 255, 255]];
  const selected = candidates.sort((a, b) => {
    const distance = (color) => color.reduce((total, channel, index) => total + ((channel - source[index]) ** 2), 0);
    return distance(b) - distance(a);
  })[0];
  return `#${selected.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function buildGarmentPrompt(metadata = {}, chromaKey = "#00ff00") {
  const name = metadata.name || "clothing item";
  const category = metadata.part || "wardrobe item";
  const primary = metadata.color || "the exact visible color";
  const secondary = metadata.secondaryColor ? ` with distinct secondary color ${metadata.secondaryColor}` : "";
  const details = Array.isArray(metadata.tags) && metadata.tags.length
    ? metadata.tags.join(", ")
    : "all visible construction and design details";

  return `Use case: background-extraction
Asset type: ecommerce catalog product cutout source

Input image: The reference photograph shows the exact garment, either by itself or worn by a person. Use it only to identify and reconstruct the garment.

Primary request: Reconstruct ONLY the complete empty ${name} (${category}) as a clean, front-facing ecommerce catalog product photograph. If a wearer is present, remove them. Remove every other garment, object, and background element. Show the complete item naturally arranged and symmetrical, with no person, body, mannequin, or hanger visible.

Garment fidelity: Preserve the reference garment's exact primary color ${primary}${secondary}, material and texture, silhouette, neckline, sleeves, fastenings, pattern, and distinctive details (${details}). Preserve any clearly legible existing graphic or logo exactly, but do not invent or reinterpret uncertain logos, text, pockets, seams, hardware, colors, or decoration.

Composition: Centered straight-on product view. Keep the entire garment inside the frame with generous, even padding on every side. No cropping or truncation.

Background: Perfectly flat, absolutely uniform solid ${chromaKey} chroma-key color, edge-to-edge. No shadows, gradient, texture, vignette, floor, horizon, reflection, or lighting variation.

Lighting: Neutral diffuse product lighting contained on the garment only.

Avoid: person, body, skin, hair, mannequin, hanger, props, other garments, retail tags, cast shadow, contact shadow, reflection, watermark, caption, border, background variation, or chroma spill.

Critical: Use no ${chromaKey} anywhere in the garment. Produce exactly one complete garment with a crisp, separable outer silhouette.`;
}

function cleanupTolerance(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(18, Math.min(110, Math.round(parsed))) : 46;
}

function removeKeyedSpill(data, index, keyedChannels, neutralLevel) {
  let remaining = Math.ceil(keyedChannels.reduce((total, channel) => total + data[index + channel], 0) - (neutralLevel * keyedChannels.length));
  let active = keyedChannels.filter((channel) => data[index + channel] > 0);
  while (remaining > 0 && active.length) {
    const share = Math.ceil(remaining / active.length);
    const next = [];
    for (const channel of active) {
      const reduction = Math.min(data[index + channel], share, remaining);
      data[index + channel] -= reduction;
      remaining -= reduction;
      if (data[index + channel] > 0) next.push(channel);
    }
    active = next;
  }
}

export async function processChromaBackground(bytes, key, options = {}) {
  const tolerance = cleanupTolerance(options.tolerance);
  const feather = 80;
  const target = [1, 3, 5].map((offset) => Number.parseInt(key.slice(offset, offset + 2), 16));
  const keyedChannels = target.map((channel, index) => channel > 200 ? index : null).filter((index) => index !== null);
  const neutralChannels = target.map((channel, index) => channel < 55 ? index : null).filter((index) => index !== null);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.sqrt(
      ((data[index] - target[0]) ** 2)
      + ((data[index + 1] - target[1]) ** 2)
      + ((data[index + 2] - target[2]) ** 2),
    );
    if (distance <= tolerance) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
    } else {
      if (distance < tolerance + feather) data[index + 3] = Math.round(data[index + 3] * ((distance - tolerance) / feather));
      const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
      const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
      const spill = Math.max(0, keyedLevel - neutralLevel);
      if (spill > 0) {
        const spillAlpha = Math.max(0, 1 - (Math.max(0, spill - 4) / 150));
        data[index + 3] = Math.round(data[index + 3] * spillAlpha);
        removeKeyedSpill(data, index, keyedChannels, neutralLevel);
      }
      if (data[index + 3] <= 8) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
      }
    }
  }
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
    const residualSpill = Math.max(0, keyedLevel - neutralLevel);
    if (residualSpill > 0) {
      removeKeyedSpill(data, index, keyedChannels, neutralLevel);
    }
  }
  const keyedOutput = await sharp(data, { raw: info }).png().toBuffer();
  const framedOutput = await frameTransparentGarment(keyedOutput);
  const { data: framedData, info: framedInfo } = await sharp(framedOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < framedData.length; index += 4) {
    if (framedData[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + framedData[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + framedData[index + channel], 0) / neutralChannels.length;
    const residualSpill = Math.max(0, keyedLevel - neutralLevel);
    if (residualSpill <= 0) continue;
    removeKeyedSpill(framedData, index, keyedChannels, neutralLevel);
  }
  const output = await sharp(framedData, { raw: framedInfo }).png().toBuffer();
  const verification = await verifyNoChromaSpill(output, key);
  return { bytes: output, verification, tolerance };
}

export async function removeChromaBackground(bytes, key, options = {}) {
  const result = await processChromaBackground(bytes, key, options);
  if (options.strict !== false && result.verification.contaminatedPixels > 1) {
    throw new Error(`Background cleanup left ${result.verification.contaminatedPixels} chroma-contaminated pixels`);
  }
  return result.bytes;
}

export async function frameTransparentGarment(bytes, canvasSize = 1024, occupancy = 0.88) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    if (data[index + 3] <= 8) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) throw new Error("Background removal did not leave a visible garment");

  const trimmed = await sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
  const targetSize = Math.max(1, Math.round(canvasSize * Math.max(0.5, Math.min(0.96, occupancy))));
  const resized = await sharp(trimmed)
    .resize(targetSize, targetSize, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((canvasSize - resized.info.width) / 2);
  const top = Math.floor((canvasSize - resized.info.height) / 2);
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized.data, left, top }])
    .png()
    .toBuffer();
}

async function verifyNoChromaSpill(bytes, key) {
  const target = [1, 3, 5].map((offset) => Number.parseInt(key.slice(offset, offset + 2), 16));
  const keyedChannels = target.map((channel, index) => channel > 200 ? index : null).filter((index) => index !== null);
  const neutralChannels = target.map((channel, index) => channel < 55 ? index : null).filter((index) => index !== null);
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let contaminatedPixels = 0;
  let maxSpill = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
    const spill = Math.max(0, keyedLevel - neutralLevel);
    maxSpill = Math.max(maxSpill, spill);
    if (spill > 1.5) contaminatedPixels += 1;
  }
  return { contaminatedPixels, maxSpill };
}

async function atomicJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(tmp, file);
  } catch (error) {
    if (!["EBUSY", "EXDEV", "EPERM"].includes(error.code)) {
      await rm(tmp, { force: true });
      throw error;
    }
    await copyFile(tmp, file);
    await rm(tmp, { force: true });
  }
}

function stageState() {
  return { status: "pending", decision: null, attempts: 0, assetUrl: null, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupTolerance: 46, cleanupDiagnostics: null, error: null, prompt: null, updatedAt: null, openAIAttempts: [], lastOpenAIRequestId: null };
}

async function openAIAnalyze({ key, baseUrl, model, image, mime, request, record }) {
  try {
    const result = await request(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [
          { type: "input_text", text: "Identify every distinct wearable clothing item visible in this image. A photo may show one isolated garment or a person wearing several items. Return one record per actual item that should enter a wardrobe. Ignore the person's body and non-wearable background objects. For each item, include a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image: x and y are the top-left corner, followed by width and height. Boxes may overlap when garments overlap, but each box must focus on one distinct item. Use only these category ids: upperbody, wholebody_up, lowerbody, onepiece, accessories_up, shoes. Use onepiece only for a dress, jumpsuit, suit, tracksuit, or swimsuit that forms a complete look by itself. Suggest a concise specific name, a short specific garment subcategory (for example majica, košulja, pulover, hlače, traperice, jakna, kaput, sako, haljina, kombinezon, odijelo, trenirka, or kupaći kostim — use the closest accurate Croatian term even if none of these match exactly), the visible brand name only if a logo or label is clearly legible (otherwise null), primary hex color, optional genuinely distinct secondary hex color, and 1-4 useful lowercase detail tags." },
          { type: "input_image", image_url: `data:${mime};base64,${image.toString("base64")}` },
        ] }],
        text: { format: { type: "json_schema", name: "wardrobe_items", strict: true, schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", minItems: 0, maxItems: 8, items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, part: { type: "string", enum: ["upperbody", "wholebody_up", "lowerbody", "onepiece", "accessories_up", "shoes"] }, subcategory: { type: "string" }, brand: { anyOf: [{ type: "string" }, { type: "null" }] }, color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, secondaryColor: { anyOf: [{ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, { type: "null" }] }, tags: { type: "array", items: { type: "string" }, maxItems: 4 }, boundingBox: { type: "object", additionalProperties: false, properties: { x: { type: "integer", minimum: 0, maximum: 999 }, y: { type: "integer", minimum: 0, maximum: 999 }, width: { type: "integer", minimum: 1, maximum: 1000 }, height: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["x", "y", "width", "height"] } }, required: ["name", "part", "subcategory", "brand", "color", "secondaryColor", "tags", "boundingBox"] } } }, required: ["items"] } } },
      }),
    }, "analysis", null, (response) => response.json());
    const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OpenAI analysis returned no structured result");
    const parsed = JSON.parse(outputText);
    if (!Array.isArray(parsed.items)) throw new Error("OpenAI analysis returned an invalid clothing list");
    await record?.("analysis", "succeeded");
    return parsed.items;
  } catch (error) {
    await record?.("analysis", "failed");
    throw error;
  }
}

export function wardrobeImportApi(options = {}) {
  let root;
  let jobsDir;
  let importedFile;
  let libraryAssetDir;
  const running = new Map();
  const metadataStore = options.metadataStore || null;
  const privateStorage = options.storage || null;
  const setting = (name, fallback = "") => options.env?.[name] || process.env[name] || fallback;
  const apiBaseUrl = () => setting("OPENAI_API_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const jobKey = (id, file) => `jobs/${id}/${path.basename(file)}`;
  const libraryKey = (file) => `wardrobe/${path.basename(file)}`;

  async function writeJobAsset(id, file, bytes) {
    const target = path.join(jobsDir, id, path.basename(file));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o600 });
    if (privateStorage) await privateStorage.put(jobKey(id, file), bytes, "image/png");
  }

  async function readJobAsset(id, file) {
    try { return await readFile(path.join(jobsDir, id, path.basename(file))); }
    catch (error) {
      if (error.code !== "ENOENT" || !privateStorage) throw error;
      return privateStorage.get(jobKey(id, file));
    }
  }

  async function deleteJobData(id) {
    await rm(path.join(jobsDir, id), { recursive: true, force: true });
    await metadataStore?.deleteJob(id);
    await privateStorage?.deletePrefix(`jobs/${id}`);
  }
  const requestOpenAI = async (url, init, kind, onAttempt, consume = (response) => response) => {
    const execute = async () => {
      await options.beforeOpenAI?.(kind);
      await options.recordOpenAI?.(kind, "requested");
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        try {
          const requestInit = typeof init === "function" ? await init(attempt) : init;
          const response = await fetch(url, { ...requestInit, signal: AbortSignal.timeout(options.openAITimeoutMs || 90_000) });
          const retrying = (response.status === 429 || response.status >= 500) && attempt < 2;
          const requestId = responseRequestId(response);
          const errorBody = response.ok ? null : await readOpenAIError(response);
          let value;
          if (response.ok) value = await consume(response);
          const telemetry = {
            kind,
            attempt: attempt + 1,
            status: response.status,
            durationMs: Date.now() - startedMs,
            requestId,
            cfRay: response.headers.get("cf-ray") || null,
            outcome: response.ok ? "succeeded" : retrying ? "retrying" : "failed",
            error: errorBody?.message?.slice(0, 500) || errorBody?.preview?.slice(0, 500) || null,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
          await Promise.allSettled([options.recordOpenAIAttempt?.(telemetry), onAttempt?.(telemetry)].filter(Boolean));
          if (retrying) {
            lastError = Object.assign(new Error(errorBody?.message || `OpenAI ${kind === "images" ? "image" : "analysis"} request failed (${response.status})`), {
              status: response.status, requestId, cfRay: telemetry.cfRay, openAIErrorCode: errorBody?.code, openAIErrorType: errorBody?.type,
            });
            await new Promise((resolve) => setTimeout(resolve, responseRetryDelay(response, attempt, options.openAIRetryBaseMs ?? 1_200)));
            continue;
          }
          if (!response.ok) {
            const gatewayHint = response.status === 520 && !requestId
              ? " The gateway did not issue an OpenAI request ID; wait briefly and use Retry."
              : "";
            throw Object.assign(new Error(`${errorBody?.message || `OpenAI ${kind === "images" ? "image" : "analysis"} request failed (${response.status})`}${gatewayHint}`), {
              noRetry: true, status: response.status, requestId, cfRay: telemetry.cfRay, openAIErrorCode: errorBody?.code, openAIErrorType: errorBody?.type,
            });
          }
          return value;
        } catch (error) {
          lastError = error;
          if (error.noRetry) throw error;
          const retrying = attempt < 2 && !["AbortError", "TimeoutError"].includes(error.name);
          const telemetry = {
            kind,
            attempt: attempt + 1,
            status: error.status || null,
            durationMs: Date.now() - startedMs,
            requestId: error.requestId || null,
            cfRay: error.cfRay || null,
            outcome: retrying ? "retrying" : "failed",
            error: String(error.message || error.name || "Network request failed").slice(0, 500),
            startedAt,
            finishedAt: new Date().toISOString(),
          };
          await Promise.allSettled([options.recordOpenAIAttempt?.(telemetry), onAttempt?.(telemetry)].filter(Boolean));
          if (!retrying) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(12_000, (options.openAIRetryBaseMs ?? 1_200) * (2 ** attempt))));
        }
      }
      throw lastError;
    };
    return options.runOpenAI ? options.runOpenAI(execute) : execute();
  };

  async function setupStatus() {
    const hasApiKey = Boolean(setting("OPENAI_API_KEY").trim());
    const referenceSetting = setting("WARDROBE_MODEL_REFERENCE", "data/model-reference.png");
    const referencePath = path.resolve(root, referenceSetting);
    let hasModelReference = false;
    try {
      hasModelReference = privateStorage
        ? await privateStorage.exists(options.modelReferenceStorageKey || "settings/model-reference.png")
        : (await stat(referencePath)).isFile();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      ready: hasApiKey,
      tryOnReady: hasApiKey && hasModelReference,
      hasApiKey,
      hasModelReference,
      modelReference: referenceSetting,
    };
  }

  async function loadJob(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
    if (metadataStore) return metadataStore.loadJob(id);
    try { return JSON.parse(await readFile(path.join(jobsDir, id, "job.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async function saveJob(job) {
    job.updatedAt = new Date().toISOString();
    if (metadataStore) return metadataStore.saveJob(job);
    await atomicJson(path.join(jobsDir, job.id, "job.json"), job);
  }

  async function loadImported() {
    if (metadataStore) return metadataStore.loadImported();
    try { return JSON.parse(await readFile(importedFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  async function persistImported(job, includeModeled = false) {
    const id = `import-${job.id}`;
    await mkdir(libraryAssetDir, { recursive: true });
    const garmentName = `${id}-garment.png`;
    const garmentSource = job.stages.garment.assetUrl
      ? path.basename(new URL(job.stages.garment.assetUrl, "http://localhost").pathname)
      : `garment-${job.stages.garment.attempts}.png`;
    const garmentBytes = await readJobAsset(job.id, garmentSource);
    if (privateStorage) await privateStorage.put(libraryKey(garmentName), garmentBytes, "image/png");
    else await copyFile(path.join(jobsDir, job.id, garmentSource), path.join(libraryAssetDir, garmentName));
    const thumbnailName = `${id}-garment-thumb.png`;
    const thumbnailBytes = await sharp(garmentBytes).resize(480, 480, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    if (privateStorage) await privateStorage.put(libraryKey(thumbnailName), thumbnailBytes, "image/png");
    else await writeFile(path.join(libraryAssetDir, thumbnailName), thumbnailBytes);
    let modeledImage = null;
    let modeledBytes = null;
    if (includeModeled) {
      const modeledName = `${id}-modeled.jpg`;
      const modeledSource = job.stages.modeled.assetUrl
        ? path.basename(new URL(job.stages.modeled.assetUrl, "http://localhost").pathname)
        : `modeled-${job.stages.modeled.attempts}.png`;
      const modeledSourceBytes = await readJobAsset(job.id, modeledSource);
      modeledBytes = await sharp(modeledSourceBytes).rotate().toColorspace("srgb").jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      if (privateStorage) await privateStorage.put(libraryKey(modeledName), modeledBytes, "image/jpeg");
      else await writeFile(path.join(libraryAssetDir, modeledName), modeledBytes);
      modeledImage = `${LIBRARY_ASSET_ROOT}/${modeledName}`;
    }
    const metadata = job.metadata || {};
    const records = await loadImported();
    const existing = records.find((record) => record.id === id);
    const record = {
      id,
      name: metadata.name || "New piece",
      part: metadata.part || "upperbody",
      subcategory: metadata.subcategory || "",
      brand: metadata.brand || "",
      color: metadata.color || "#d8d0c2",
      secondaryColor: metadata.secondaryColor || null,
      palette: [metadata.color, metadata.secondaryColor].filter(Boolean),
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      image: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
      thumbnail: `${LIBRARY_ASSET_ROOT}/${thumbnailName}`,
      modeledImage: modeledImage || existing?.modeledImage || null,
      importJobId: job.id,
    };
    const next = [...records.filter((item) => item.id !== id), record];
    if (metadataStore) {
      // The "thumbnail" asset kind needs migrations/003_wardrobe_item_details.sql applied first
      // (extends the wardrobe_assets.asset_kind enum) — until then, inserting one here would
      // violate the enum constraint and fail the whole import. The thumbnail file itself is
      // still written to storage above; re-add tracking here once migrated.
      await metadataStore.saveImported(record, {
        garment: { key: libraryKey(garmentName), mime: "image/png", bytes: garmentBytes },
        modeled: modeledBytes ? { key: libraryKey(`${id}-modeled.jpg`), mime: "image/jpeg", bytes: modeledBytes } : null,
      });
    } else await atomicJson(importedFile, next);
    return record;
  }

  // Applies a stage-progress update (loadJob -> mutate phase -> saveJob), the pattern that
  // repeats at every checkpoint of a generation run. `onlyIfProcessing` guards the OpenAI
  // streaming-progress callback, which can otherwise report stale progress after a job moved
  // on (rejected/deleted) while a request was in flight.
  async function setStagePhase(jobId, stageName, phase, { onlyIfProcessing = false } = {}) {
    const job = await loadJob(jobId);
    if (!job?.stages?.[stageName]) return;
    if (onlyIfProcessing && job.stages[stageName].status !== "processing") return;
    job.stages[stageName].phase = phase;
    job.stages[stageName].updatedAt = new Date().toISOString();
    await saveJob(job);
  }

  async function recordStageAttempt(jobId, stageName, attemptNumber, telemetry) {
    const latest = await loadJob(jobId);
    if (!latest?.stages?.[stageName]) return;
    const latestStage = latest.stages[stageName];
    const entry = { generationAttempt: attemptNumber, ...telemetry };
    latestStage.openAIAttempts = [...(latestStage.openAIAttempts || []), entry].slice(-20);
    if (entry.requestId) latestStage.lastOpenAIRequestId = entry.requestId;
    latestStage.updatedAt = entry.finishedAt;
    await saveJob(latest);
  }

  function onOpenAIAttempt(jobId, stageName, attemptNumber) {
    return (telemetry) => Promise.allSettled([
      options.recordOpenAIAttempt?.(telemetry),
      recordStageAttempt(jobId, stageName, attemptNumber, telemetry),
    ].filter(Boolean));
  }

  // Marks a stage "processing" and bumps its attempt counter. Returns null (instead of
  // throwing) if even this bookkeeping step fails, since the caller runs unawaited and must
  // never let an error escape as an unhandled rejection.
  async function beginStage(job, stageName) {
    try {
      const current = await loadJob(job.id);
      const stage = current.stages[stageName];
      stage.status = "processing"; stage.phase = "waiting_for_openai"; stage.decision = null; stage.error = null; stage.attempts += 1; stage.startedAt = new Date().toISOString(); stage.updatedAt = stage.startedAt;
      await saveJob(current);
      return { current, stage };
    } catch (error) {
      console.error("Failed to start background generation task", { jobId: job.id, stageName, name: error.name, message: error.message, stack: error.stack });
      return null;
    }
  }

  // Renders the garment cutout: OpenAI reconstructs the item on a solid chroma-key
  // background, then local pixel processing removes that background. `chromaKeyUsed` and
  // `failedAssetUrl` (the raw pre-cleanup render, useful for diagnosing a failed cleanup) are
  // attached to any thrown error so the caller can record them even on failure.
  async function generateGarmentImage(current, stage, stageName) {
    let failedAssetUrl = null;
    const chromaKeyUsed = chooseChromaKey(current.metadata.color);
    try {
      const key = setting("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY is not configured");
      const sourceFile = current.internal.cropFile || current.internal.originalFile;
      const original = { data: await readJobAsset(current.id, sourceFile), mime: "image/png", name: sourceFile };
      const basePrompt = options.garmentPrompt || buildGarmentPrompt(current.metadata, chromaKeyUsed);
      const prompt = stage.prompt ? `${basePrompt}\nUser regeneration direction: ${stage.prompt}` : basePrompt;
      let bytes = await editImageWithOpenAI({
        key, baseUrl: apiBaseUrl(), model: setting("OPENAI_GARMENT_MODEL", setting("OPENAI_IMAGE_MODEL", "gpt-image-2")),
        quality: setting("OPENAI_GARMENT_QUALITY", setting("OPENAI_IMAGE_QUALITY", "medium")), size: "1024x1024", images: [original], prompt,
        timeoutMs: options.openAITimeoutMs, retryBaseMs: options.openAIRetryBaseMs,
        beforeOpenAI: options.beforeOpenAI, recordOpenAI: options.recordOpenAI, runOpenAI: options.runOpenAI,
        onAttempt: onOpenAIAttempt(current.id, stageName, stage.attempts),
        onProgress: () => setStagePhase(current.id, stageName, "openai_rendering", { onlyIfProcessing: true }),
      });
      const rawName = `${stageName}-${stage.attempts}-source.png`;
      await writeJobAsset(current.id, rawName, bytes);
      failedAssetUrl = `${ASSET_ROOT}/${current.id}/${rawName}`;
      await setStagePhase(current.id, stageName, "removing_background");
      bytes = await removeChromaBackground(bytes, chromaKeyUsed);
      return { bytes, chromaKeyUsed, failedAssetUrl };
    } catch (error) {
      throw Object.assign(error, { chromaKeyUsed, failedAssetUrl });
    }
  }

  // Renders the "on me" editorial photo from the approved garment cutout plus the owner's
  // private reference photo.
  async function generateModeledImage(current, stage, stageName) {
    const key = setting("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY is not configured");
    const garmentName = current.stages.garment.assetUrl
      ? path.basename(new URL(current.stages.garment.assetUrl, "http://localhost").pathname)
      : `garment-${current.stages.garment.attempts}.png`;
    const garment = { data: await readJobAsset(current.id, garmentName), mime: "image/png", name: "garment.png" };
    const modelPath = path.resolve(root, setting("WARDROBE_MODEL_REFERENCE", "data/model-reference.png"));
    let modelData;
    try {
      modelData = privateStorage
        ? await privateStorage.get(options.modelReferenceStorageKey || "settings/model-reference.png")
        : await readFile(modelPath);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Model reference not found at ${modelPath}. Set WARDROBE_MODEL_REFERENCE or add data/model-reference.png.`);
      throw error;
    }
    const model = { data: modelData, mime: "image/png", name: "model.png" };
    const basePrompt = options.modeledPrompt || "Create a professional horizontal 3:2 editorial fashion photograph of the person in Image 1 wearing the exact garment from Image 2. Preserve the person's recognizable identity, face, hair, age and proportions. Preserve every garment color, material, fit, construction, graphic, logo and distinctive detail. Keep the complete featured item clearly visible and unobstructed, use understated neutral supporting clothes, realistic anatomy, natural light, authentic fabric, a tasteful real-world setting, and leave environmental space around the model. No text, watermark, product mockup, or synthetic appearance.";
    const prompt = stage.prompt ? `${basePrompt}\nUser regeneration direction: ${stage.prompt}` : basePrompt;
    const bytes = await editImageWithOpenAI({
      key, baseUrl: apiBaseUrl(), model: setting("OPENAI_MODELED_MODEL", setting("OPENAI_IMAGE_MODEL", "gpt-image-2")),
      quality: setting("OPENAI_MODELED_QUALITY", setting("OPENAI_IMAGE_QUALITY", "medium")), size: "1536x1024", images: [model, garment], prompt,
      timeoutMs: options.openAITimeoutMs, retryBaseMs: options.openAIRetryBaseMs,
      beforeOpenAI: options.beforeOpenAI, recordOpenAI: options.recordOpenAI, runOpenAI: options.runOpenAI,
      onAttempt: onOpenAIAttempt(current.id, stageName, stage.attempts),
    });
    await setStagePhase(current.id, stageName, "storing_result");
    return { bytes };
  }

  async function finalizeStageSuccess(current, stageName, output, bytes, chromaKeyUsed) {
    await writeJobAsset(current.id, path.basename(output), bytes);
    const fresh = await loadJob(current.id);
    const freshStage = fresh.stages[stageName];
    freshStage.status = "review";
    freshStage.phase = "ready_for_review";
    freshStage.assetUrl = `${ASSET_ROOT}/${fresh.id}/${path.basename(output)}`;
    freshStage.failedAssetUrl = null;
    freshStage.cleanupPreviewUrl = null;
    freshStage.cleanupDiagnostics = null;
    if (chromaKeyUsed) freshStage.chromaKey = chromaKeyUsed;
    freshStage.updatedAt = new Date().toISOString();
    await saveJob(fresh);
  }

  // Records a failed generation attempt. Wrapped in its own try/catch since this runs from
  // inside the outer catch handler of an unawaited background task: if recording the failure
  // itself fails (e.g. a transient DB error), that must be logged, not thrown, or it becomes
  // an unhandled rejection that crashes the whole server.
  async function recordStageFailure(jobId, stageName, error) {
    console.error("Background generation task failed", { jobId, stageName, name: error.name, message: error.message, stack: error.stack });
    try {
      const fresh = await loadJob(jobId);
      const freshStage = fresh.stages[stageName];
      freshStage.status = "failed"; freshStage.phase = "failed"; freshStage.error = error.message; freshStage.updatedAt = new Date().toISOString();
      if (typeof error.failedAssetUrl === "string") freshStage.failedAssetUrl = error.failedAssetUrl;
      if (error.chromaKeyUsed) freshStage.chromaKey = error.chromaKeyUsed;
      await saveJob(fresh);
    } catch (recordError) {
      console.error("Failed to record background generation failure", { jobId, stageName, name: recordError.name, message: recordError.message, stack: recordError.stack });
    }
  }

  async function runGenerationTask(job, stageName) {
    const started = await beginStage(job, stageName);
    if (!started) return;
    const { current, stage } = started;
    try {
      const output = path.join(jobsDir, current.id, `${stageName}-${stage.attempts}.png`);
      const { bytes, chromaKeyUsed } = stageName === "garment"
        ? await generateGarmentImage(current, stage, stageName)
        : await generateModeledImage(current, stage, stageName);
      await finalizeStageSuccess(current, stageName, output, bytes, chromaKeyUsed);
    } catch (error) {
      await recordStageFailure(job.id, stageName, error);
    }
  }

  // The caller never awaits this (`void generate(...)`), so any error that escapes
  // runGenerationTask becomes an unhandled promise rejection, which crashes the whole Node
  // process by default — runGenerationTask and everything it calls must therefore always
  // resolve, never reject.
  function generate(job, stageName) {
    const lock = `${job.id}:${stageName}`;
    if (running.has(lock)) return running.get(lock);
    const task = runGenerationTask(job, stageName).finally(() => running.delete(lock));
    running.set(lock, task);
    return task;
  }

  async function handler(req, res, next) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/import/")) return next();
    try {
      if (url.pathname === "/api/import/wardrobe" && req.method === "GET") {
        return json(res, 200, await loadImported());
      }
      if (url.pathname === "/api/import/config" && req.method === "GET") {
        return json(res, 200, await setupStatus());
      }
      const wardrobeDeleteMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[a-f0-9-]{36})$/i);
      if (wardrobeDeleteMatch && req.method === "DELETE") {
        const id = wardrobeDeleteMatch[1];
        const records = await loadImported();
        const next = records.filter((record) => record.id !== id);
        if (next.length === records.length) return json(res, 404, { error: "Imported wardrobe item not found" });
        if (metadataStore) {
          const keys = await metadataStore.deleteImported(id);
          await Promise.all(keys.map((key) => privateStorage?.delete(key)));
        } else {
          await atomicJson(importedFile, next);
          await Promise.all([
            rm(path.join(libraryAssetDir, `${id}-garment.png`), { force: true }),
            rm(path.join(libraryAssetDir, `${id}-garment-thumb.png`), { force: true }),
            // Modeled images were stored as PNG before JPEG conversion; remove either extension.
            rm(path.join(libraryAssetDir, `${id}-modeled.jpg`), { force: true }),
            rm(path.join(libraryAssetDir, `${id}-modeled.png`), { force: true }),
          ]);
        }
        return json(res, 200, { deleted: true, id });
      }
      const modeledDeleteMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[a-f0-9-]{36})\/modeled$/i);
      if (modeledDeleteMatch && req.method === "DELETE") {
        const id = modeledDeleteMatch[1];
        const records = await loadImported();
        const record = records.find((item) => item.id === id);
        if (!record) return json(res, 404, { error: "Imported wardrobe item not found" });
        record.modeledImage = null;
        if (metadataStore) {
          const key = await metadataStore.deleteModeled(id);
          if (key) await privateStorage?.delete(key);
        } else {
          await atomicJson(importedFile, records);
          await Promise.all([
            rm(path.join(libraryAssetDir, `${id}-modeled.jpg`), { force: true }),
            rm(path.join(libraryAssetDir, `${id}-modeled.png`), { force: true }),
          ]);
        }
        return json(res, 200, { deleted: true, id, keptGarment: true });
      }
      const libraryAssetMatch = url.pathname.match(/^\/api\/import\/library\/([\w.-]+)$/i);
      if (libraryAssetMatch && req.method === "GET") {
        const name = path.basename(libraryAssetMatch[1]);
        const file = path.join(libraryAssetDir, name);
        const bytes = privateStorage ? await privateStorage.get(libraryKey(name)) : await readFile(file);
        // Garment cutouts/thumbnails stay PNG (need alpha); modeled "on me" photos are stored as JPEG.
        res.setHeader("Content-Type", /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png");
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.end(bytes);
      }
      const assetMatch = url.pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
      if (assetMatch && req.method === "GET") {
        const name = path.basename(assetMatch[2]);
        const bytes = await readJobAsset(assetMatch[1], name);
        res.setHeader("Content-Type", name.endsWith(".svg") ? "image/svg+xml" : "image/png");
        // Every regenerate/recrop writes a new filename (stage attempt or timestamp suffixed),
        // so a given URL's bytes never change — safe to cache long-term despite the job being transient.
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.end(bytes);
      }
      if (url.pathname === API_ROOT && req.method === "POST") {
        const setup = await setupStatus();
        if (!setup.ready) {
          const missing = [
            !setup.hasApiKey && "OPENAI_API_KEY in .env",
          ].filter(Boolean).join(" and ");
          return json(res, 503, { error: `Setup required: add ${missing}, then restart the app.` });
        }
        const input = await body(req, Math.ceil((options.maxUploadBytes || 10 * 1024 * 1024) * 1.4) + 64 * 1024);
        const image = await decodeImage(input, { maxBytes: options.maxUploadBytes || 10 * 1024 * 1024, maxPixels: options.maxImagePixels || 40_000_000 });
        const normalizedImage = image.data;
        const key = setting("OPENAI_API_KEY");
        const detected = (await openAIAnalyze({ key, baseUrl: apiBaseUrl(), model: setting("OPENAI_VISION_MODEL", "gpt-5.4-mini"), image: normalizedImage, mime: "image/png", request: requestOpenAI, record: options.recordOpenAI })).map(normalizeMetadata);
        const jobs = [];
        for (const metadata of detected) {
          const id = randomUUID();
          const dir = path.join(jobsDir, id); await mkdir(dir, { recursive: true });
          const originalFile = "original.png";
          const cropFile = "crop.png";
          const croppedImage = await cropDetectedItem(normalizedImage, metadata.boundingBox);
          await writeJobAsset(id, originalFile, normalizedImage);
          await writeJobAsset(id, cropFile, croppedImage);
          const now = new Date().toISOString();
          const cropStage = { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now };
          const job = { id, status: "active", metadata, stages: { crop: cropStage, garment: stageState(), modeled: stageState() }, createdAt: now, updatedAt: now, internal: { originalFile, cropFile, originalMime: "image/png" } };
          job.originalAssetUrl = `${ASSET_ROOT}/${id}/${originalFile}`;
          await saveJob(job); jobs.push(publicJob(job));
        }
        return json(res, 202, { jobs, noClothingDetected: jobs.length === 0 });
      }
      if (url.pathname === API_ROOT && req.method === "GET") {
        const ids = metadataStore ? await metadataStore.listJobIds() : await readdir(jobsDir).catch(() => []);
        const loadedJobs = (await Promise.all(ids.map((id) => loadJob(id)))).filter(Boolean);
        const hiddenJobs = loadedJobs.filter((job) => job.status === "complete" || job.stages.crop?.status === "rejected" || job.stages.garment.status === "rejected" || job.stages.modeled.status === "rejected");
        await Promise.all(hiddenJobs.map((job) => deleteJobData(job.id)));
        const jobs = loadedJobs.filter((job) => !hiddenJobs.includes(job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return json(res, 200, jobs.map(publicJob));
      }
      const match = url.pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
      if (!match) return json(res, 404, { error: "Not found" });
      const job = await loadJob(match[1]);
      if (!job) return json(res, 404, { error: "Job not found" });
      const action = match[2] || "";
      if (!action && req.method === "GET") return json(res, 200, publicJob(job));
      if (!action && req.method === "DELETE") {
        await deleteJobData(job.id);
        return json(res, 200, { deleted: true, id: job.id });
      }
      if (action === "metadata" && (req.method === "PATCH" || req.method === "PUT")) {
        const input = await body(req);
        if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw Object.assign(new Error("metadata must be an object"), { status: 400 });
        job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata }); await saveJob(job);
        return json(res, 200, publicJob(job));
      }
      const cleanupAction = action.match(/^stages\/garment\/(cleanup-preview|cleanup-accept)$/);
      if (cleanupAction && req.method === "POST") {
        const stage = job.stages.garment;
        if (stage.status !== "failed" || !stage.failedAssetUrl) {
          throw Object.assign(new Error("No failed garment source is available for cleanup"), { status: 409 });
        }
        const input = await body(req);
        const tolerance = cleanupTolerance(input.tolerance);
        const sourceName = path.basename(new URL(stage.failedAssetUrl, "http://localhost").pathname);
        const source = await readJobAsset(job.id, sourceName);
        const key = stage.chromaKey || chooseChromaKey(job.metadata?.color);
        const cleaned = await processChromaBackground(source, key, { tolerance });
        const previewName = `garment-${stage.attempts}-cleanup-${tolerance}.png`;
        const previewUrl = `${ASSET_ROOT}/${job.id}/${previewName}`;
        await writeJobAsset(job.id, previewName, cleaned.bytes);
        stage.chromaKey = key;
        stage.cleanupTolerance = cleaned.tolerance;
        stage.cleanupDiagnostics = cleaned.verification;
        stage.cleanupPreviewUrl = previewUrl;
        stage.updatedAt = new Date().toISOString();
        if (cleanupAction[1] === "cleanup-accept") {
          stage.status = "review";
          stage.decision = null;
          stage.error = null;
          stage.assetUrl = previewUrl;
        }
        await saveJob(job);
        return json(res, 200, publicJob(job));
      }
      if (action === "stages/crop/recrop" && req.method === "POST") {
        if (job.stages.crop.status !== "review") throw Object.assign(new Error("Crop is not ready for review"), { status: 409 });
        const input = await body(req);
        const box = normalizeBoundingBox(input.boundingBox);
        const original = await readJobAsset(job.id, job.internal.originalFile);
        const cropped = await cropDetectedItem(original, box);
        const cropFile = `crop-${Date.now()}.png`;
        await writeJobAsset(job.id, cropFile, cropped);
        job.internal.cropFile = cropFile;
        job.metadata.boundingBox = box;
        job.stages.crop.assetUrl = `${ASSET_ROOT}/${job.id}/${cropFile}`;
        job.stages.crop.updatedAt = new Date().toISOString();
        await saveJob(job);
        return json(res, 200, publicJob(job));
      }
      const stageMatch = action.match(/^stages\/(crop|garment|modeled)\/(approve|reject|regenerate)$/);
      if (stageMatch && req.method === "POST") {
        const [, stageName, decision] = stageMatch;
        if (!STAGES.has(stageName)) throw Object.assign(new Error("Invalid stage"), { status: 400 });
        if (decision === "regenerate") {
          if (stageName === "crop") throw Object.assign(new Error("Upload the image again to create new crops"), { status: 400 });
          if (["queued", "processing"].includes(job.stages[stageName].status) || running.has(`${job.id}:${stageName}`)) {
            throw Object.assign(new Error("Generation is already in progress"), { status: 409 });
          }
          if (!["failed", "review"].includes(job.stages[stageName].status)) {
            throw Object.assign(new Error("Stage is not ready to retry"), { status: 409 });
          }
          const input = await body(req);
          job.stages[stageName].prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1200) || null : null;
          job.stages[stageName].status = "queued";
          job.stages[stageName].decision = null;
          await saveJob(job);
          void generate(job, stageName);
          return json(res, 202, publicJob(job));
        }
        if (!DECISIONS.has(decision) || job.stages[stageName].status !== "review") throw Object.assign(new Error("Stage is not ready for review"), { status: 409 });
        const previousStatus = job.stages[stageName].status;
        const previousDecision = job.stages[stageName].decision;
        const previousJobStatus = job.status;
        job.stages[stageName].decision = decision === "approve" ? "approved" : "rejected";
        job.stages[stageName].status = job.stages[stageName].decision;
        job.stages[stageName].error = null;
        job.stages[stageName].updatedAt = new Date().toISOString();
        const startGarment = stageName === "crop" && decision === "approve" && job.stages.garment.status === "pending";
        const finishGarmentImport = stageName === "garment" && decision === "approve";
        if (stageName === "modeled" && decision === "approve") job.status = "complete";
        if (finishGarmentImport) {
          job.status = "complete";
          job.stages.modeled.status = "skipped";
          job.stages.modeled.phase = "available_in_outfit_studio";
        }
        await saveJob(job);
        if (decision === "approve" && stageName !== "crop") {
          try {
            await persistImported(job, stageName === "modeled");
          } catch (error) {
            job.stages[stageName].status = previousStatus;
            job.stages[stageName].decision = previousDecision;
            job.status = previousJobStatus;
            await saveJob(job);
            throw error;
          }
        }
        if (decision === "reject") await deleteJobData(job.id);
        if (startGarment) void generate(job, "garment");
        const response = publicJob(job);
        if (job.status === "complete") await deleteJobData(job.id);
        return json(res, 200, response);
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode = error.code === "ENOENT" ? 404 : error.status || 500;
      return json(res, statusCode, { error: statusCode === 500 ? "Internal server error" : error.message, ...(process.env.NODE_ENV === "development" && statusCode === 500 ? { detail: error.message } : {}) });
    }
  }

  async function initialize(resolvedRoot) {
      root = resolvedRoot;
      const dataDir = path.resolve(root, setting("WARDROBE_DATA_DIR", "data"));
      jobsDir = path.join(dataDir, "jobs");
      importedFile = path.join(dataDir, "library.json");
      libraryAssetDir = path.join(dataDir, "imported");
      await mkdir(jobsDir, { recursive: true });
      await mkdir(libraryAssetDir, { recursive: true });
      const ids = metadataStore ? await metadataStore.listJobIds() : await readdir(jobsDir).catch(() => []);
      for (const id of ids) {
        const job = await loadJob(id);
        if (!job) continue;
        if (job.status === "complete") {
          try {
            await persistImported(job, job.stages.modeled?.status !== "skipped");
            await deleteJobData(job.id);
          } catch (error) {
            job.status = "active";
            job.stages.modeled.status = "review";
            job.stages.modeled.decision = null;
            job.stages.modeled.error = null;
            await saveJob(job);
          }
          continue;
        }
        if (job.stages.crop?.status === "rejected" || job.stages.garment.status === "rejected" || job.stages.modeled.status === "rejected") {
          await deleteJobData(job.id);
          continue;
        }
        if (job.stages.crop && job.stages.crop.status !== "approved") continue;
        if (["processing", "queued"].includes(job.stages.garment.status)) {
          job.stages.garment.status = "pending";
          await saveJob(job);
          void generate(job, "garment");
        } else if (job.stages.garment.status === "approved" && ["pending", "processing", "queued"].includes(job.stages.modeled.status)) {
          await persistImported(job, false);
          await deleteJobData(job.id);
        }
      }
  }

  return {
    name: "wardrobe-import-job-api",
    apply: "serve",
    async configResolved(config) {
      await initialize(config.root);
    },
    initialize,
    handler,
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
