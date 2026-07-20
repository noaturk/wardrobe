import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_ACCEPT, isHeicFile, isSupportedImageFile, prepareImageFile } from "../src/image-files.mjs";

test("browser picker advertises standard and iPhone image formats", () => {
  assert.match(IMAGE_ACCEPT, /image\/jpeg/);
  assert.match(IMAGE_ACCEPT, /image\/heic/);
  assert.match(IMAGE_ACCEPT, /\.heif/);
});

test("HEIC is recognized by MIME or file extension", () => {
  assert.equal(isHeicFile({ name: "IMG_0042.HEIC", type: "" }), true);
  assert.equal(isHeicFile({ name: "upload", type: "image/heif" }), true);
  assert.equal(isHeicFile({ name: "shirt.jpg", type: "image/jpeg" }), false);
});

test("unsupported files are rejected and standard images pass through unchanged", async () => {
  const jpeg = { name: "shirt.jpg", type: "image/jpeg" };
  assert.equal(isSupportedImageFile(jpeg), true);
  assert.equal(isSupportedImageFile({ name: "notes.pdf", type: "application/pdf" }), false);
  assert.equal(await prepareImageFile(jpeg), jpeg);
});
