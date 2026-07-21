import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const OPTIONS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function normalizePasswordHash(encoded) {
  let value = String(encoded || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  value = value.replaceAll("\\$", "$");
  if (value.startsWith("scrypt.")) value = value.replaceAll(".", "$");
  return value;
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12) throw new Error("Password must contain at least 12 characters");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, OPTIONS);
  return `scrypt$${OPTIONS.N}$${OPTIONS.r}$${OPTIONS.p}$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, salt, expected] = normalizePasswordHash(encoded).split("$");
    if (algorithm !== "scrypt" || !salt || !expected) return false;
    const expectedKey = Buffer.from(expected, "base64url");
    const actualKey = Buffer.from(await scrypt(password, Buffer.from(salt, "base64url"), expectedKey.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }));
    return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
  } catch {
    return false;
  }
}
