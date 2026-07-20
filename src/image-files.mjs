export const IMAGE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",");

const STANDARD_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const HEIC_MIMES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

function extension(file) {
  return String(file?.name || "").split(".").pop()?.toLowerCase() || "";
}

export function isHeicFile(file) {
  return HEIC_MIMES.has(String(file?.type || "").toLowerCase()) || ["heic", "heif"].includes(extension(file));
}

export function isSupportedImageFile(file) {
  return STANDARD_MIMES.has(String(file?.type || "").toLowerCase()) || isHeicFile(file);
}

export async function prepareImageFile(file) {
  if (!isHeicFile(file)) return file;
  try {
    const { heicTo } = await import("heic-to/csp");
    const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    const jpeg = Array.isArray(converted) ? converted[0] : converted;
    if (!(jpeg instanceof Blob) || !jpeg.size) throw new Error("HEIC conversion returned no image");
    const baseName = String(file.name || "iphone-photo").replace(/\.(heic|heif)$/i, "") || "iphone-photo";
    return new File([jpeg], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    throw new Error(`Could not convert ${file.name || "this HEIC photo"}. Try exporting it as JPEG on your device.`);
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}
