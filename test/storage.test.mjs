import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalPrivateStorage, safeKey } from "../server/storage.mjs";

test("private local storage rejects traversal and supports lifecycle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wardrobe-storage-"));
  try {
    const storage = new LocalPrivateStorage(directory);
    assert.throws(() => safeKey("../secret"), /Invalid/);
    assert.throws(() => storage.resolve("/absolute"), /Invalid/);
    await storage.put("items/a.png", Buffer.from("private"));
    assert.equal(await storage.exists("items/a.png"), true);
    assert.deepEqual(await storage.get("items/a.png"), Buffer.from("private"));
    await storage.delete("items/a.png");
    assert.equal(await storage.exists("items/a.png"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
