import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import session from "express-session";
import sharp from "sharp";
import { createApp } from "../server/app.mjs";
import { LocalPrivateStorage } from "../server/storage.mjs";
import { hashPassword } from "../server/password.mjs";

const OPENAI_BASE = "https://api.openai.com/v1";

async function png(r = 120, g = 90, b = 60) {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

// Fake OpenAI image endpoint: returns a valid PNG without any real network call or cost.
function installFetchMock(t) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    if (String(url).includes("/images/edits")) {
      const body = { data: [{ b64_json: (await png(40, 80, 160)).toString("base64") }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

async function fixture({ withReference = true, withWardrobe = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-outfits-"));
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.html"), "<!doctype html><title>Private app</title>");
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const storage = new LocalPrivateStorage(path.join(root, "private"));

  const wardrobe = [
    { id: "import-a", name: "Linen shirt", part: "upperbody", color: "#d8d0c2", secondaryColor: null, image: "/api/import/library/import-a-garment.png", thumbnail: "/api/import/library/import-a-garment.png" },
    { id: "import-b", name: "Dark jeans", part: "lowerbody", color: "#2f3a55", secondaryColor: null, image: "/api/import/library/import-b-garment.png", thumbnail: "/api/import/library/import-b-garment.png" },
    { id: "import-c", name: "White sneakers", part: "shoes", color: "#efefef", secondaryColor: null, image: "/api/import/library/import-c-garment.png", thumbnail: "/api/import/library/import-c-garment.png" },
  ];
  if (withWardrobe) {
    await writeFile(path.join(dataDir, "library.json"), JSON.stringify(wardrobe));
    for (const piece of wardrobe) {
      await storage.put(`wardrobe/${path.basename(piece.image)}`, await png(), "image/png");
    }
  }
  if (withReference) await storage.put("settings/model-reference.png", await png(200, 180, 160), "image/png");

  const config = {
    root,
    production: false,
    port: 3000,
    appOrigin: new URL("http://localhost:3000"),
    trustProxy: false,
    adminUsername: "noa@example.test",
    adminPasswordHash: await hashPassword("correct-test-password"),
    sessionSecret: "test-secret-that-is-long-enough-for-session-signing",
    sessionCookieName: "wardrobe.sid",
    sessionTtlMs: 60_000,
    databaseUrl: "",
    openAIKey: "dummy-key",
    openAIBaseUrl: OPENAI_BASE,
    openAIImageModel: "gpt-image-2",
    openAIImageQuality: "medium",
    maxConcurrentOpenAIJobs: 1,
    dailyImageLimit: 5,
    openAITimeoutMs: 5000,
    maxUploadBytes: 1024 * 1024,
    maxImagePixels: 1_000_000,
    dataDir,
    modelReference: path.join(dataDir, "reference.png"),
  };
  const app = await createApp(config, { sessionStore: new session.MemoryStore(), serveBuild: true, storage, openAIRetryBaseMs: 1 });
  return { root, app, storage, wardrobe };
}

function csrfFrom(html) {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
}

async function login(app) {
  const agent = request.agent(app);
  const page = await agent.get("/auth/login");
  await agent.post("/auth/login").type("form").send({ _csrf: csrfFrom(page.text), username: "noa@example.test", password: "correct-test-password" }).expect(302);
  const sessionResponse = await agent.get("/api/auth/session").expect(200);
  return { agent, csrf: sessionResponse.body.csrfToken };
}

test("outfit gallery starts empty and is not blocked by the upload rate limiter", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { agent } = await login(app);
  for (let index = 0; index < 40; index += 1) {
    await agent.get("/api/outfits").expect(200);
  }
});

test("generating a try-on stores a private image and never leaks the storage key", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t);
  const { agent, csrf } = await login(app);

  const created = await agent.post("/api/outfits/generate")
    .set("X-CSRF-Token", csrf)
    .send({ itemIds: ["import-a", "import-b"], name: "Easy everyday" })
    .expect(201);
  assert.equal(created.body.name, "Easy everyday");
  assert.equal(created.body.storageKey, undefined);
  assert.match(created.body.image, /^\/api\/outfits\/[a-f0-9-]{36}\/image$/);
  assert.equal(calls.filter((call) => call.url.includes("/images/edits")).length, 1);

  const listed = await agent.get("/api/outfits").expect(200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].storageKey, undefined);

  const image = await agent.get(created.body.image).expect(200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.match(image.headers["cache-control"], /no-store/);
  assert.equal(image.headers["x-content-type-options"], "nosniff");
});

test("single-item AI try-on is supported while empty and oversized selections are rejected", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  installFetchMock(t);
  const { agent, csrf } = await login(app);
  const single = await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: ["import-a"] }).expect(201);
  assert.equal(single.body.source, "ai");
  assert.deepEqual(single.body.itemIds, ["import-a"]);
  await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: [] }).expect(400);
  await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: ["a", "b", "c", "d", "e", "f"] }).expect(400);
});

test("owner can attach a real worn photo to one wardrobe item without OpenAI usage", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t);
  const { agent, csrf } = await login(app);
  const created = await agent.post("/api/outfits/photos?itemId=import-a")
    .set("X-CSRF-Token", csrf)
    .set("Content-Type", "image/jpeg")
    .send(await sharp(await png(140, 110, 90)).jpeg().toBuffer())
    .expect(201);
  assert.equal(created.body.source, "owner-photo");
  assert.deepEqual(created.body.itemIds, ["import-a"]);
  assert.equal(calls.length, 0);
  const image = await agent.get(created.body.image).expect(200);
  assert.equal(image.headers["content-type"], "image/png");
  const usage = await agent.get("/api/usage").expect(200);
  assert.deepEqual(usage.body.today.images, { requested: 0, succeeded: 0, failed: 0 });
});

test("blocks generation until a reference photo exists", async (t) => {
  const { root, app } = await fixture({ withReference: false });
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t);
  const { agent, csrf } = await login(app);
  await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: ["import-a", "import-b"] }).expect(409);
  assert.equal(calls.length, 0, "OpenAI must not be called without a reference photo");
});

test("an invalid CSRF token returns 403, not 500", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  installFetchMock(t);
  const { agent } = await login(app);
  const response = await agent.post("/api/outfits/generate")
    .set("X-CSRF-Token", "not-the-real-token")
    .send({ itemIds: ["import-a", "import-b"] })
    .expect(403);
  assert.match(response.body.error, /csrf/i);
});

test("deleting a single try-on removes its private image", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  installFetchMock(t);
  const { agent, csrf } = await login(app);
  const created = await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: ["import-a", "import-b"] }).expect(201);
  await agent.get(created.body.image).expect(200);
  await agent.delete(`/api/outfits/${created.body.id}`).set("X-CSRF-Token", csrf).expect(204);
  await agent.get(created.body.image).expect(404);
  await agent.get("/api/outfits").expect(200, []);
});

test("deleting the whole wardrobe also removes generated outfits", async (t) => {
  const { root, app, storage } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  installFetchMock(t);
  const { agent, csrf } = await login(app);
  const created = await agent.post("/api/outfits/generate").set("X-CSRF-Token", csrf).send({ itemIds: ["import-a", "import-b"] }).expect(201);
  const storageKeyExisted = await storage.exists(`outfits/${created.body.id}.png`);
  assert.equal(storageKeyExisted, true);

  await agent.delete("/api/data/wardrobe").set("X-CSRF-Token", csrf).set("X-Confirm-Action", "DELETE WARDROBE").expect(204);

  await agent.get("/api/outfits").expect(200, []);
  await agent.get(created.body.image).expect(404);
  assert.equal(await storage.exists(`outfits/${created.body.id}.png`), false);
});
