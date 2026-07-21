import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "../server/config.mjs";

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    APP_ORIGIN: "https://wardrobe.example.test",
    ADMIN_USERNAME: "owner@example.test",
    ADMIN_PASSWORD_HASH: "scrypt$test-placeholder",
    SESSION_SECRET: "a-secure-session-secret-with-more-than-32-characters",
    OPENAI_API_KEY: "test-openai-key",
    DB_HOST: "db.example.test",
    DB_NAME: "wardrobe",
    DB_USER: "wardrobe",
    DB_PASSWORD: "test-password",
    STORAGE_DRIVER: "local",
    ALLOW_LOCAL_PRODUCTION_STORAGE: "true",
    ...overrides,
  };
}

test("production local storage must be explicitly outside the deployed app", () => {
  const root = path.resolve("/tmp/wardrobe-config-root");
  assert.throws(
    () => loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "data/private" }), root),
    /outside the deployed application directory/,
  );
  assert.throws(
    () => loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "../wardrobe-private", ALLOW_LOCAL_PRODUCTION_STORAGE: "false" }), root),
    /requires explicit/,
  );
});

test("production accepts an explicit private sibling storage directory", () => {
  const root = path.resolve("/tmp/wardrobe-config-root");
  const config = loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "../wardrobe-private" }), root);
  assert.equal(config.storageDriver, "local");
  assert.equal(config.localStorageDir, path.resolve(root, "../wardrobe-private"));
  assert.equal(config.production, true);
});

test("production accepts a Hostinger-safe dot-delimited password hash", () => {
  const root = path.resolve("/tmp/wardrobe-config-root");
  const config = loadConfig(productionEnv({
    LOCAL_STORAGE_DIR: "../wardrobe-private",
    ADMIN_PASSWORD_HASH: "scrypt.32768.8.1.salt.hash",
  }), root);
  assert.equal(config.adminPasswordHash, "scrypt$32768$8$1$salt$hash");
});

test("image generation limit is manually configurable and zero means unlimited", () => {
  const root = path.resolve("/tmp/wardrobe-config-root");
  const unlimited = loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "../wardrobe-private" }), root);
  const capped = loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "../wardrobe-private", DAILY_IMAGE_GENERATION_LIMIT: "37" }), root);
  assert.equal(unlimited.dailyImageLimit, 0);
  assert.equal(capped.dailyImageLimit, 37);
  assert.throws(
    () => loadConfig(productionEnv({ LOCAL_STORAGE_DIR: "../wardrobe-private", DAILY_IMAGE_GENERATION_LIMIT: "-1" }), root),
    /between 0 and 100000/,
  );
});
