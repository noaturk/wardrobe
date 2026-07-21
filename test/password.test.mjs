import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, normalizePasswordHash, verifyPassword } from "../server/password.mjs";

test("scrypt password hashes verify without storing cleartext", async () => {
  const password = "a-long-test-password";
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword(password, encoded.replaceAll("$", ".")), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  assert.equal(normalizePasswordHash(`  "${encoded}"  `), encoded);
  assert.equal(normalizePasswordHash(encoded.replaceAll("$", "\\$")), encoded);
});

test("short passwords are rejected by the hash command", async () => {
  await assert.rejects(() => hashPassword("too-short"), /12 characters/);
});
