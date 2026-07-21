import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { averageHash, hammingDistance } from "../server/perceptual-hash.mjs";

async function solidColorPng(r, g, b, size = 200) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

async function checkerboardPng(size = 200) {
  const half = Math.floor(size / 2);
  const light = await sharp({ create: { width: half, height: half, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
  const dark = await sharp({ create: { width: half, height: half, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: light, left: 0, top: 0 }, { input: dark, left: half, top: 0 }, { input: dark, left: 0, top: half }, { input: light, left: half, top: half }])
    .png().toBuffer();
}

test("hashes a 64-bit value as 16 hex characters", async () => {
  const hash = await averageHash(await solidColorPng(120, 120, 120));
  assert.equal(hash.length, 16);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test("near-identical images (re-encoded) hash to a small distance", async () => {
  const original = await checkerboardPng();
  const reencoded = await sharp(original).jpeg({ quality: 90 }).toBuffer();
  const distance = hammingDistance(await averageHash(original), await averageHash(reencoded));
  assert.ok(distance <= 4, `expected a small distance, got ${distance}`);
});

test("very different images hash to a large distance", async () => {
  // Solid-color images are a degenerate case for average-hash: every pixel equals the
  // average, so any flat color hashes to the same all-1s value. Use textured images instead,
  // like a real garment photo would have.
  const checkerboard = await checkerboardPng();
  const invertedCheckerboard = await sharp(checkerboard).negate().toBuffer();
  const distance = hammingDistance(await averageHash(checkerboard), await averageHash(invertedCheckerboard));
  assert.ok(distance >= 32, `expected a large distance, got ${distance}`);
});

test("hammingDistance treats missing or mismatched hashes as infinitely far apart", () => {
  assert.equal(hammingDistance(null, "abc"), Infinity);
  assert.equal(hammingDistance("abc", "abcd"), Infinity);
  assert.equal(hammingDistance("ffffffffffffffff", "ffffffffffffffff"), 0);
  assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
});
