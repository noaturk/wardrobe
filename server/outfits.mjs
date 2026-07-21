import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import { sanitizeImage } from "./images.mjs";
import { editImageWithOpenAI } from "./openai-images.mjs";

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

function publicOutfit(record) {
  const { storageKey: _storageKey, ...safe } = record;
  return { ...safe, image: `/api/outfits/${record.id}/image` };
}

async function normalizePng(bytes) {
  return sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
}

function buildOutfitPrompt(items, direction = "") {
  const list = items.map((item, index) => `Image ${index + 2}: ${item.name} (${item.part}), exact colors ${[item.color, item.secondaryColor].filter(Boolean).join(" and ") || "as shown"}`).join("\n");
  return `Create one realistic full-body vertical editorial fashion photograph.

Image 1 is the private reference person. Preserve that person's recognizable identity, face, hair, age, skin tone, body proportions and natural anatomy.

Dress the person in every selected wardrobe item below, using each product image as the exact visual reference:
${list}

Preserve the exact garment colors, graphics, logos, material, silhouette, construction and fit. Combine all compatible selected pieces into one coherent outfit. Do not replace, recolor, duplicate or omit a selected item. Add only minimal neutral basics when physically required by an incomplete selection. Show the complete outfit clearly, including footwear when selected. Use natural light and a tasteful real-world setting. No text, watermark, collage, split screen, product grid, extra person or distorted anatomy.${direction ? `\n\nOwner direction: ${direction}` : ""}`;
}

export function createOutfitRouter(options) {
  const router = express.Router();
  const file = path.join(options.dataDir, "outfits.json");
  const metadata = options.metadataStore;
  const storage = options.storage;

  const loadOutfits = () => metadata?.loadOutfits ? metadata.loadOutfits() : readJson(file, []);
  const saveOutfit = async (record) => {
    if (metadata?.saveOutfit) return metadata.saveOutfit(record);
    const records = await loadOutfits();
    return writeJson(file, [...records.filter((item) => item.id !== record.id), record]);
  };
  const removeOutfit = async (id) => {
    if (metadata?.deleteOutfit) return metadata.deleteOutfit(id);
    const records = await loadOutfits();
    const removed = records.find((item) => item.id === id) || null;
    await writeJson(file, records.filter((item) => item.id !== id));
    return removed;
  };
  const loadWardrobe = () => metadata?.loadImported
    ? metadata.loadImported()
    : readJson(path.join(options.dataDir, "library.json"), []);

  router.get("/api/outfits", async (_req, res, next) => {
    try { res.json((await loadOutfits()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicOutfit)); }
    catch (error) { next(error); }
  });

  router.get("/api/outfits/:id/image", async (req, res, next) => {
    try {
      const record = (await loadOutfits()).find((item) => item.id === req.params.id);
      if (!record) return res.status(404).json({ error: "Outfit not found" });
      const bytes = await storage.get(record.storageKey);
      res.set({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(bytes);
    } catch (error) { return next(error); }
  });

  const generateLimiter = options.generateLimiter || ((_req, _res, next) => next());
  router.post("/api/outfits/photos", generateLimiter, express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: options.maxUploadBytes,
  }), async (req, res, next) => {
    try {
      const rawIds = typeof req.query.itemIds === "string" ? req.query.itemIds : (typeof req.query.itemId === "string" ? req.query.itemId : "");
      const ids = [...new Set(rawIds.split(",").map((value) => value.trim()).filter(Boolean))];
      if (ids.length < 1 || ids.length > 5) return res.status(400).json({ error: "Choose between 1 and 5 wardrobe items" });
      const wardrobe = await loadWardrobe();
      const selected = ids.map((itemId) => wardrobe.find((item) => item.id === itemId)).filter(Boolean);
      if (selected.length !== ids.length) return res.status(404).json({ error: "One or more wardrobe items no longer exist" });
      const clean = await sanitizeImage(req.body, { maxBytes: options.maxUploadBytes, maxPixels: options.maxImagePixels });
      const id = randomUUID();
      const storageKey = `outfits/${id}.png`;
      await storage.put(storageKey, clean.bytes, "image/png");
      const record = {
        id,
        source: "owner-photo",
        name: selected.length === 1 ? `${selected[0].name} on me` : "My outfit photo",
        itemIds: ids,
        items: selected.map(({ id: itemId, name, part, color, image }) => ({ id: itemId, name, part, color, image })),
        storageKey,
        createdAt: new Date().toISOString(),
      };
      try { await saveOutfit(record); }
      catch (error) { await storage.delete(storageKey).catch(() => undefined); throw error; }
      return res.status(201).json(publicOutfit(record));
    } catch (error) { return next(error); }
  });

  router.post("/api/outfits/generate", generateLimiter, express.json({ limit: "16kb" }), async (req, res, next) => {
    try {
      const ids = [...new Set(Array.isArray(req.body.itemIds) ? req.body.itemIds.filter((id) => typeof id === "string") : [])];
      if (ids.length < 1 || ids.length > 5) return res.status(400).json({ error: "Choose between 1 and 5 wardrobe items" });
      const wardrobe = await loadWardrobe();
      const selected = ids.map((id) => wardrobe.find((item) => item.id === id)).filter(Boolean);
      if (selected.length !== ids.length) return res.status(404).json({ error: "One or more wardrobe items no longer exist" });
      if (!await storage.exists("settings/model-reference.png")) return res.status(409).json({ error: "Upload a private reference photo in Settings first" });

      const reference = await normalizePng(await storage.get("settings/model-reference.png"));
      const images = [{ data: reference, name: "reference.png" }];
      for (const [index, item] of selected.entries()) {
        const name = path.basename(new URL(item.image, "http://localhost").pathname);
        const bytes = await normalizePng(await storage.get(`wardrobe/${name}`));
        images.push({ data: bytes, name: `item-${index + 1}.png` });
      }

      const generated = await normalizePng(await editImageWithOpenAI({
        key: options.openAIKey,
        baseUrl: options.openAIBaseUrl,
        model: options.imageModel,
        prompt: buildOutfitPrompt(selected, typeof req.body.direction === "string" ? req.body.direction.trim().slice(0, 500) : ""),
        images,
        size: "1024x1536",
        quality: options.imageQuality,
        timeoutMs: options.openAITimeoutMs,
        retryBaseMs: options.openAIRetryBaseMs,
        beforeOpenAI: () => options.usage.assertImageAllowed(options.dailyImageLimit),
        recordOpenAI: (kind, outcome) => options.usage.record(kind, outcome),
        runOpenAI: (task) => options.semaphore.run(task),
        onAttempt: options.recordOpenAIAttempt,
      }));
      const id = randomUUID();
      const storageKey = `outfits/${id}.png`;
      await storage.put(storageKey, generated, "image/png");
      const record = {
        id,
        source: "ai",
        name: typeof req.body.name === "string" ? req.body.name.trim().slice(0, 100) || (selected.length === 1 ? `${selected[0].name} try-on` : "Selected outfit") : (selected.length === 1 ? `${selected[0].name} try-on` : "Selected outfit"),
        itemIds: ids,
        items: selected.map(({ id: itemId, name, part, color, image }) => ({ id: itemId, name, part, color, image })),
        storageKey,
        createdAt: new Date().toISOString(),
      };
      try { await saveOutfit(record); }
      catch (error) { await storage.delete(storageKey).catch(() => undefined); throw error; }
      return res.status(201).json(publicOutfit(record));
    } catch (error) { return next(error); }
  });

  router.delete("/api/outfits/:id", async (req, res, next) => {
    try {
      const removed = await removeOutfit(req.params.id);
      if (!removed) return res.status(404).json({ error: "Outfit not found" });
      await storage.delete(removed.storageKey);
      return res.status(204).end();
    } catch (error) { return next(error); }
  });

  return router;
}
