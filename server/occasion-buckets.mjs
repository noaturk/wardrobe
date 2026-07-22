import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { findMatchingBuckets } from "../src/occasion-outfits.mjs";

async function readJson(file, fallback = []) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    trigger: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
    boost: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
    penalty: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
  },
  required: ["trigger", "boost", "penalty"],
};

// A single, un-retried, text-only call: this is a low-stakes convenience feature (worst case,
// the owner sees "couldn't get an AI suggestion" and can just try rephrasing), not worth the
// image-generation retry machinery used elsewhere for expensive, higher-stakes calls.
async function generateBucketWithOpenAI({ key, baseUrl, model, description, timeoutMs }) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [{
        type: "input_text",
        text: `A person wants outfit suggestions for this occasion, described in their own words: "${description}". Reply with keyword lists, in the same language as the description, for matching this occasion against a wardrobe of clothing items in future: "trigger" is 3-8 short alternate phrases someone might type for this same occasion; "boost" is 5-10 lowercase clothing-related keywords (garment names, styles, fabrics, formality words) that would suit it; "penalty" is 0-8 lowercase clothing-related keywords that would clash with it. Keep every keyword short (one or two words).`,
      }] }],
      text: { format: { type: "json_schema", name: "occasion_bucket", strict: true, schema: SCHEMA } },
    }),
  });
  if (!response.ok) throw Object.assign(new Error(`OpenAI request failed (${response.status})`), { status: response.status });
  const result = await response.json();
  const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI response did not contain a structured result");
  const parsed = JSON.parse(outputText);
  if (!Array.isArray(parsed.trigger) || !Array.isArray(parsed.boost) || !Array.isArray(parsed.penalty)) {
    throw new Error("OpenAI response had an unexpected shape");
  }
  return parsed;
}

export function createOccasionBucketsRouter(options) {
  const router = express.Router();
  const metadataStore = options.metadataStore;
  const file = path.join(options.dataDir, "occasion-buckets.json");

  const loadBuckets = () => metadataStore?.loadOccasionBuckets ? metadataStore.loadOccasionBuckets() : readJson(file, []);
  const saveBucket = async (bucket) => {
    if (metadataStore?.saveOccasionBucket) return metadataStore.saveOccasionBucket(bucket);
    const current = await loadBuckets();
    return writeJson(file, [...current.filter((item) => item.id !== bucket.id), bucket]);
  };

  router.get("/api/occasion-buckets", async (_req, res, next) => {
    try { res.json(await loadBuckets()); }
    catch (error) { next(error); }
  });

  const generateLimiter = options.generateLimiter || ((_req, _res, next) => next());
  router.post("/api/occasion-buckets/generate", generateLimiter, express.json({ limit: "1kb" }), async (req, res, next) => {
    try {
      const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 200) : "";
      if (!description) return res.status(400).json({ error: "A non-empty description is required" });

      const custom = await loadBuckets();
      if (findMatchingBuckets(description, custom).length) return res.status(200).json({ matched: true, buckets: custom });

      await options.usage.record("analysis", "requested");
      let generated;
      try {
        generated = await generateBucketWithOpenAI({
          key: options.openAIKey, baseUrl: options.openAIBaseUrl, model: options.model, description, timeoutMs: options.timeoutMs,
        });
      } catch (error) {
        await options.usage.record("analysis", "failed");
        throw error;
      }
      await options.usage.record("analysis", "succeeded");

      const bucket = { id: randomUUID(), ...generated, source: "ai", createdFromDescription: description, createdAt: new Date().toISOString() };
      await saveBucket(bucket);
      return res.status(201).json({ matched: false, bucket, buckets: [...custom, bucket] });
    } catch (error) { return next(error); }
  });

  return router;
}
