import sharp from "sharp";

const HASH_SIZE = 8; // 8x8 grayscale = 64-bit hash, packed as 16 hex characters.
const NIBBLE_BIT_COUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// A simple "average hash": shrink to 8x8 grayscale, then for each pixel record whether it's
// brighter or darker than the image's average brightness. Two photos of the same garment
// (even at slightly different crops/lighting) tend to produce hashes a small Hamming distance
// apart, while unrelated photos land far apart — good enough for "does this look like
// something already in the wardrobe", not meant to be a rigorous perceptual hash.
export async function averageHash(bytes) {
  const { data } = await sharp(bytes)
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  let bits = "";
  for (const value of data) bits += value >= average ? "1" : "0";
  let hex = "";
  for (let index = 0; index < bits.length; index += 4) hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

export function hammingDistance(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < hashA.length; index += 1) {
    distance += NIBBLE_BIT_COUNT[Number.parseInt(hashA[index], 16) ^ Number.parseInt(hashB[index], 16)];
  }
  return distance;
}
