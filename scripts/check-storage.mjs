import "dotenv/config";
import crypto from "node:crypto";
import { loadConfig } from "../server/config.mjs";
import { createStorage } from "../server/storage.mjs";

const config = loadConfig({ ...process.env, NODE_ENV: "development" }, process.cwd());
const storage = createStorage(config);
const key = `healthchecks/${crypto.randomUUID()}.txt`;
const expected = crypto.randomBytes(32);

try {
  await storage.put(key, expected, "text/plain");
  if (!await storage.exists(key)) throw new Error("Storage write completed, but the object cannot be found");
  const actual = await storage.get(key);
  if (!crypto.timingSafeEqual(actual, expected)) throw new Error("Storage read did not return the bytes that were written");
  console.log(`Private ${config.storageDriver} storage check passed: write, head, read and delete work.`);
} finally {
  await storage.delete(key).catch(() => undefined);
}
