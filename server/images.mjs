import sharp from "sharp";

const SIGNATURES = [
  { mime: "image/png", test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/jpeg", test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: "image/webp", test: (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" },
];

export function detectImageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  return SIGNATURES.find((signature) => signature.test(bytes))?.mime || null;
}

export async function sanitizeImage(bytes, { maxBytes, maxPixels, output = "png" }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw Object.assign(new Error("Image payload is empty"), { status: 400 });
  if (bytes.length > maxBytes) throw Object.assign(new Error("Image is larger than the configured upload limit"), { status: 413 });
  const mime = detectImageMime(bytes);
  if (!mime) throw Object.assign(new Error("Only genuine PNG, JPEG, and WebP images are accepted"), { status: 415 });
  try {
    const decoder = sharp(bytes, { failOn: "error", limitInputPixels: maxPixels, sequentialRead: true });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
      throw Object.assign(new Error("Image dimensions exceed the configured limit"), { status: 413 });
    }
    const pipeline = decoder.rotate().toColorspace("srgb");
    const clean = output === "jpeg"
      ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      : await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { bytes: clean, mime: output === "jpeg" ? "image/jpeg" : "image/png", width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Image could not be safely decoded"), { status: 415 });
  }
}
