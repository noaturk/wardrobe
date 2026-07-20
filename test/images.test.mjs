import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectImageMime, sanitizeImage } from "../server/images.mjs";

test("image signature is checked independently of claimed MIME", async () => {
  assert.equal(detectImageMime(Buffer.from("not an image")), null);
  await assert.rejects(
    () => sanitizeImage(Buffer.from("RIFFxxxxFAKE"), { maxBytes: 1000, maxPixels: 1000 }),
    /genuine PNG, JPEG, and WebP/,
  );
});

test("safe decode re-encodes as PNG and strips metadata", async () => {
  const source = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#bc845d" },
  }).withMetadata({ exif: { IFD0: { Copyright: "private metadata" } } }).jpeg().toBuffer();
  const clean = await sanitizeImage(source, { maxBytes: 1024 * 1024, maxPixels: 1000 });
  assert.equal(detectImageMime(clean.bytes), "image/png");
  const metadata = await sharp(clean.bytes).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 16);
});

test("upload byte and pixel limits are enforced", async () => {
  const source = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => sanitizeImage(source, { maxBytes: 10, maxPixels: 1000 }), /upload limit/);
  await assert.rejects(() => sanitizeImage(source, { maxBytes: 10000, maxPixels: 100 }), /decode|dimensions/);
});
