import crypto from "node:crypto";

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TOTP secret must be base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret, timestamp, step = 30) {
  const counter = Math.floor(timestamp / 1000 / step);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

export function verifyTotp(code, secret, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || "")) || !secret) return false;
  return [-1, 0, 1].some((window) => {
    const expected = codeAt(secret, now + window * 30_000);
    return crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(expected));
  });
}

export { codeAt };
