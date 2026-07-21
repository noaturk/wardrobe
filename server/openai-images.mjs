import sharp from "sharp";

function requestId(response) {
  return response.headers.get("x-request-id") || response.headers.get("openai-request-id") || null;
}

function retryDelay(response, attempt, baseMs) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, Math.round(seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return Math.min(12_000, baseMs * (2 ** attempt));
}

async function errorPayload(response) {
  const text = await response.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; }
  catch { /* A gateway may return HTML or an empty body. */ }
  return {
    message: typeof parsed?.error?.message === "string" ? parsed.error.message : null,
    code: typeof parsed?.error?.code === "string" ? parsed.error.code : null,
    type: typeof parsed?.error?.type === "string" ? parsed.error.type : null,
    preview: parsed ? null : text.replace(/\s+/g, " ").trim().slice(0, 240) || null,
  };
}

function ssePayload(block) {
  const payload = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!payload || payload === "[DONE]") return null;
  return JSON.parse(payload);
}

async function imageBytes(response, onProgress) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const result = await response.json();
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI response did not contain image data");
    return Buffer.from(encoded, "base64");
  }

  if (!response.body) throw new Error("OpenAI image stream did not contain a response body");
  const decoder = new TextDecoder();
  let buffered = "";
  let completed = null;
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const blocks = buffered.split(/\r?\n\r?\n/);
    buffered = blocks.pop() || "";
    for (const block of blocks) {
      const event = ssePayload(block);
      if (!event) continue;
      if (event.type === "image_edit.partial_image") await onProgress?.({ type: "partial", index: event.partial_image_index });
      else if (event.type === "image_edit.completed") completed = event.b64_json;
      else if (event.type === "error") throw new Error(event.error?.message || event.message || "OpenAI image stream failed");
    }
  }
  buffered += decoder.decode();
  if (buffered.trim()) {
    const event = ssePayload(buffered);
    if (event?.type === "image_edit.completed") completed = event.b64_json;
    if (event?.type === "error") throw new Error(event.error?.message || event.message || "OpenAI image stream failed");
  }
  if (!completed) throw new Error("OpenAI image stream ended before the final image arrived");
  return Buffer.from(completed, "base64");
}

function gatewayError(response, payload) {
  const openAIRequestId = requestId(response);
  const cfRay = response.headers.get("cf-ray") || null;
  const hint = response.status === 520 && !openAIRequestId
    ? " The gateway did not issue an OpenAI request ID; wait briefly and use Retry."
    : "";
  return Object.assign(new Error(`${payload.message || `OpenAI image request failed (${response.status})`}${hint}`), {
    status: response.status,
    requestId: openAIRequestId,
    cfRay,
    openAIErrorCode: payload.code,
    openAIErrorType: payload.type,
  });
}

export async function editImageWithOpenAI(options) {
  const normalizedImages = await Promise.all(options.images.map(async (image, index) => ({
    data: await sharp(image.data).rotate().toColorspace("srgb").png().toBuffer(),
    name: image.name?.replace(/\.[^.]+$/, ".png") || `image-${index + 1}.png`,
  })));
  const createForm = () => {
    const form = new FormData();
    form.set("model", options.model);
    form.set("prompt", options.prompt);
    form.set("size", options.size);
    form.set("quality", options.quality || "high");
    form.set("output_format", "png");
    form.set("stream", "true");
    form.set("partial_images", "1");
    if (options.background) form.set("background", options.background);
    for (const image of normalizedImages) form.append("image[]", new Blob([image.data], { type: "image/png" }), image.name);
    return form;
  };

  const execute = async () => {
    await options.beforeOpenAI?.("images");
    await options.recordOpenAI?.("images", "requested");
    let lastError;
    try {
      for (let attempt = 0; attempt < (options.maxAttempts || 3); attempt += 1) {
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        let response = null;
        try {
          response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/images/edits`, {
            method: "POST",
            headers: { Authorization: `Bearer ${options.key}` },
            body: createForm(),
            signal: AbortSignal.timeout(options.timeoutMs || 90_000),
          });
          if (!response.ok) {
            const payload = await errorPayload(response);
            const error = gatewayError(response, payload);
            const retrying = (response.status === 429 || response.status >= 500) && attempt < (options.maxAttempts || 3) - 1;
            await Promise.resolve(options.onAttempt?.({
              kind: "images", attempt: attempt + 1, status: response.status, durationMs: Date.now() - startedMs,
              requestId: error.requestId, cfRay: error.cfRay, outcome: retrying ? "retrying" : "failed",
              error: (payload.message || payload.preview || error.message).slice(0, 500), startedAt, finishedAt: new Date().toISOString(),
            })).catch(() => undefined);
            if (!retrying) throw Object.assign(error, { attemptLogged: true, noRetry: true });
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt, options.retryBaseMs ?? 1_200)));
            continue;
          }

          const bytes = await imageBytes(response, options.onProgress);
          await Promise.resolve(options.onAttempt?.({
            kind: "images", attempt: attempt + 1, status: response.status, durationMs: Date.now() - startedMs,
            requestId: requestId(response), cfRay: response.headers.get("cf-ray") || null, outcome: "succeeded", error: null,
            startedAt, finishedAt: new Date().toISOString(),
          })).catch(() => undefined);
          await options.recordOpenAI?.("images", "succeeded");
          return bytes;
        } catch (error) {
          lastError = error;
          if (error.noRetry) throw error;
          const retrying = attempt < (options.maxAttempts || 3) - 1 && error.name !== "AbortError";
          await Promise.resolve(options.onAttempt?.({
            kind: "images", attempt: attempt + 1, status: error.status || response?.status || null, durationMs: Date.now() - startedMs,
            requestId: error.requestId || (response ? requestId(response) : null), cfRay: error.cfRay || response?.headers.get("cf-ray") || null,
            outcome: retrying ? "retrying" : "failed", error: String(error.message || error.name || "Network request failed").slice(0, 500),
            startedAt, finishedAt: new Date().toISOString(),
          })).catch(() => undefined);
          if (!retrying) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(12_000, (options.retryBaseMs ?? 1_200) * (2 ** attempt))));
        }
      }
      throw lastError;
    } catch (error) {
      await options.recordOpenAI?.("images", "failed");
      throw error;
    }
  };

  return options.runOpenAI ? options.runOpenAI(execute) : execute();
}
