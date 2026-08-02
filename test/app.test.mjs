import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import session from "express-session";
import sharp from "sharp";
import { createApp } from "../server/app.mjs";
import { hashPassword } from "../server/password.mjs";

async function fixture(appOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-app-"));
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.html"), "<!doctype html><title>Private app</title>");
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
    openAIKey: "dummy",
    openAIBaseUrl: "https://api.openai.com/v1",
    maxConcurrentOpenAIJobs: 1,
    dailyImageLimit: 2,
    openAITimeoutMs: 5000,
    maxUploadBytes: 1024 * 1024,
    maxImagePixels: 1000,
    dataDir: path.join(root, "data"),
    modelReference: path.join(root, "data", "reference.png"),
  };
  const app = await createApp(config, { sessionStore: new session.MemoryStore(), serveBuild: true, openAIRetryBaseMs: 1, ...appOptions });
  return { root, app, config };
}

function csrfFrom(html) {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
}

async function login(app) {
  const agent = request.agent(app);
  const page = await agent.get("/auth/login");
  await agent.post("/auth/login").type("form").send({
    _csrf: csrfFrom(page.text),
    username: "noa@example.test",
    password: "correct-test-password",
  }).expect(302);
  const sessionResponse = await agent.get("/api/auth/session").expect(200);
  return { agent, csrf: sessionResponse.body.csrfToken };
}

async function seedFailedGarmentJob(config) {
  const id = randomUUID();
  const directory = path.join(config.dataDir, "jobs", id);
  await mkdir(directory, { recursive: true });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 180, g: 40, b: 30 } } }).png().toBuffer();
  await Promise.all([
    writeFile(path.join(directory, "original.png"), image),
    writeFile(path.join(directory, "crop.png"), image),
  ]);
  const stage = (status = "pending") => ({ status, decision: null, attempts: 0, assetUrl: null, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupTolerance: 46, cleanupDiagnostics: null, error: null, prompt: null, updatedAt: null, openAIAttempts: [], lastOpenAIRequestId: null });
  const crop = stage("approved");
  crop.decision = "approved";
  crop.assetUrl = `/api/import/assets/${id}/crop.png`;
  const garment = stage("failed");
  garment.error = "Previous generation failed";
  const now = new Date().toISOString();
  const job = {
    id,
    status: "active",
    metadata: { name: "Test shirt", part: "upperbody", color: "#b4281e", secondaryColor: null, tags: [], boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } },
    stages: { crop, garment, modeled: stage() },
    createdAt: now,
    updatedAt: now,
    internal: { originalFile: "original.png", cropFile: "crop.png", originalMime: "image/png" },
    originalAssetUrl: `/api/import/assets/${id}/original.png`,
  };
  await writeFile(path.join(directory, "job.json"), `${JSON.stringify(job, null, 2)}\n`);
  return id;
}

async function waitForJob(agent, id, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await agent.get(`/api/import/jobs/${id}`).expect(200);
    if (predicate(response.body)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for import job ${id}`);
}

test("health is public while application, API and images are private", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await request(app).get("/health")
    .expect(200, { status: "ok" })
    .expect("X-Wardrobe-Frontend", "ready");
  await request(app).get("/").expect(401).expect("Cache-Control", /no-store/);
  await request(app).get("/api/import/wardrobe").expect(401);
  await request(app).get("/api/import/library/anything.png").expect(401);
});

test("health reports when the production frontend build is missing", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(path.join(root, "dist", "index.html"));

  await request(app).get("/health")
    .expect(503, { status: "degraded" })
    .expect("X-Wardrobe-Frontend", "missing");
});

test("authenticated root serves the production frontend build", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { agent } = await login(app);

  await agent.get("/")
    .expect(200)
    .expect("Content-Type", /html/)
    .expect("Cache-Control", /no-store/)
    .expect((response) => assert.match(response.text, /<title>Private app<\/title>/));
});

test("login rotates the session, CSRF protects writes, and logout destroys it", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const agent = request.agent(app);
  const login = await agent.get("/auth/login").expect(200);
  const firstCookie = login.headers["set-cookie"]?.[0];
  const csrf = csrfFrom(login.text);
  assert.ok(firstCookie);
  assert.ok(csrf);

  const wrong = await agent.post("/auth/login")
    .type("form")
    .send({ _csrf: csrf, username: "noa@example.test", password: "incorrect-password" })
    .expect(401);
  assert.match(wrong.text, /Pogrešno korisničko ime/);

  const refreshed = await agent.get("/auth/login");
  const response = await agent.post("/auth/login")
    .type("form")
    .send({ _csrf: csrfFrom(refreshed.text), username: "noa@example.test", password: "correct-test-password" })
    .expect(302);
  const rotatedCookie = response.headers["set-cookie"]?.[0];
  assert.ok(rotatedCookie);
  assert.notEqual(rotatedCookie.split(";")[0], firstCookie.split(";")[0]);

  const sessionResponse = await agent.get("/api/auth/session").expect(200);
  await agent.post("/api/auth/logout").expect(403);
  await agent.post("/api/auth/logout").set("X-CSRF-Token", sessionResponse.body.csrfToken).expect(204);
  await agent.get("/api/auth/session").expect(401);
});

test("security headers and generic invalid credentials are present", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const agent = request.agent(app);
  const login = await agent.get("/auth/login")
    .expect("Referrer-Policy", "same-origin")
    .expect("Content-Security-Policy", /frame-ancestors 'none'/)
    .expect("Content-Security-Policy", /worker-src 'self' blob:/)
    .expect("Content-Security-Policy", /connect-src 'self' https:\/\/api\.open-meteo\.com/);
  await agent.post("/auth/login").type("form").send({
    _csrf: csrfFrom(login.text),
    username: "unknown",
    password: "correct-test-password",
  }).expect(401).expect((response) => {
    assert.match(response.text, /Pogrešno korisničko ime/);
    assert.doesNotMatch(response.text, /unknown|correct-test-password/);
  });
});

test("import status polling is not consumed by the upload rate limiter", async (t) => {
  const { root, app } = await fixture({ recordOpenAIAttempt: () => undefined });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { agent } = await login(app);
  for (let index = 0; index < 40; index += 1) {
    await agent.get("/api/import/jobs").expect(200);
  }
});

test("authenticated import workflow actions are not blocked after 30 clicks", async (t) => {
  const { root, app } = await fixture({ recordOpenAIAttempt: () => undefined });
  t.after(() => rm(root, { recursive: true, force: true }));
  const { agent, csrf } = await login(app);
  const missingId = "00000000-0000-0000-0000-000000000000";
  for (let index = 0; index < 40; index += 1) {
    await agent.delete(`/api/import/jobs/${missingId}`).set("X-CSRF-Token", csrf).expect(404, { error: "Job not found" });
  }
});

test("a failed OpenAI image request stores attempt diagnostics and one logical failed usage", async (t) => {
  const attemptLog = [];
  const { root, app, config } = await fixture({ recordOpenAIAttempt: (entry) => attemptLog.push(entry) });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = await seedFailedGarmentJob(config);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "Temporary image gateway failure" } }), {
      status: 520,
      headers: { "Content-Type": "application/json", "x-request-id": `req-test-${calls}` },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { agent, csrf } = await login(app);
  await agent.post(`/api/import/jobs/${id}/stages/garment/regenerate`).set("X-CSRF-Token", csrf).send({}).expect(202);
  const failed = await waitForJob(agent, id, (job) => job.stages.garment.status === "failed");
  assert.equal(calls, 3, failed.stages.garment.error);
  assert.equal(failed.stages.garment.error, "Temporary image gateway failure");
  assert.deepEqual(failed.stages.garment.openAIAttempts.map(({ status, requestId, outcome }) => ({ status, requestId, outcome })), [
    { status: 520, requestId: "req-test-1", outcome: "retrying" },
    { status: 520, requestId: "req-test-2", outcome: "retrying" },
    { status: 520, requestId: "req-test-3", outcome: "failed" },
  ]);
  assert.ok(failed.stages.garment.openAIAttempts.every((entry) => Number.isInteger(entry.durationMs) && entry.durationMs >= 0));
  assert.equal(attemptLog.length, 3);
  const usage = await agent.get("/api/usage").expect(200);
  assert.deepEqual(usage.body.today.images, { requested: 1, succeeded: 0, failed: 1 });
});

test("a 520 image gateway response retries with a fresh streaming request and preserves the completed image", async (t) => {
  const attemptLog = [];
  const { root, app, config } = await fixture({ recordOpenAIAttempt: (entry) => attemptLog.push(entry) });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = await seedFailedGarmentJob(config);
  const generated = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ffff" } })
    .composite([{ input: Buffer.from('<svg width="36" height="36"><rect width="36" height="36" rx="4" fill="#25345f"/></svg>'), left: 14, top: 14 }])
    .png()
    .toBuffer();
  const completed = JSON.stringify({ type: "image_edit.completed", b64_json: generated.toString("base64") });
  const bodies = [];
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    bodies.push(init.body);
    assert.equal(init.body.get("stream"), "true");
    assert.equal(init.body.get("partial_images"), "1");
    if (calls === 1) {
      return new Response("<h1>Temporary gateway problem</h1>", {
        status: 520,
        headers: { "Content-Type": "text/html", "cf-ray": "test-ray-520" },
      });
    }
    return new Response(`data: ${completed}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "x-request-id": "req-stream-success" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { agent, csrf } = await login(app);
  await agent.post(`/api/import/jobs/${id}/stages/garment/regenerate`).set("X-CSRF-Token", csrf).send({}).expect(202);
  const ready = await waitForJob(agent, id, (job) => job.stages.garment.status === "review");
  assert.equal(calls, 2, ready.stages.garment.error || "streaming retry did not call fetch twice");
  assert.notEqual(bodies[0], bodies[1]);
  assert.match(ready.stages.garment.assetUrl, /garment-1\.png$/);
  assert.deepEqual(ready.stages.garment.openAIAttempts.map(({ status, requestId, cfRay, outcome }) => ({ status, requestId, cfRay, outcome })), [
    { status: 520, requestId: null, cfRay: "test-ray-520", outcome: "retrying" },
    { status: 200, requestId: "req-stream-success", cfRay: null, outcome: "succeeded" },
  ]);
  assert.equal(attemptLog.length, 2);
  const usage = await agent.get("/api/usage").expect(200);
  assert.deepEqual(usage.body.today.images, { requested: 1, succeeded: 1, failed: 0 });
});

test("retry is rejected while the same generation is already running", async (t) => {
  const { root, app, config } = await fixture({ recordOpenAIAttempt: () => undefined });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = await seedFailedGarmentJob(config);
  const generated = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 180, g: 40, b: 30 } } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return new Response(JSON.stringify({ data: [{ b64_json: generated.toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req-running" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const { agent, csrf } = await login(app);
  const endpoint = `/api/import/jobs/${id}/stages/garment/regenerate`;
  await agent.post(endpoint).set("X-CSRF-Token", csrf).send({}).expect(202);
  await waitForJob(agent, id, (job) => job.stages.garment.status === "processing");
  await agent.post(endpoint).set("X-CSRF-Token", csrf).send({}).expect(409, { error: "Generation is already in progress" });
  release();
  await waitForJob(agent, id, (job) => ["review", "failed"].includes(job.stages.garment.status));
});

test("deleting an in-flight generation cleanly cancels its final write", async (t) => {
  const { root, app, config } = await fixture({ recordOpenAIAttempt: () => undefined });
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = await seedFailedGarmentJob(config);
  const generated = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 180, g: 40, b: 30 } } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errors = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return new Response(JSON.stringify({ data: [{ b64_json: generated.toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req-cancelled" } });
  };
  console.error = (...args) => errors.push(args);
  t.after(() => { globalThis.fetch = originalFetch; console.error = originalConsoleError; });

  const { agent, csrf } = await login(app);
  await agent.post(`/api/import/jobs/${id}/stages/garment/regenerate`).set("X-CSRF-Token", csrf).send({}).expect(202);
  await waitForJob(agent, id, (job) => job.stages.garment.status === "processing");
  await agent.delete(`/api/import/jobs/${id}`).set("X-CSRF-Token", csrf).expect(200, { deleted: true, id });
  release();
  await new Promise((resolve) => setTimeout(resolve, 250));

  await agent.get(`/api/import/jobs/${id}`).expect(404, { error: "Job not found" });
  await assert.rejects(stat(path.join(config.dataDir, "jobs", id)), { code: "ENOENT" });
  assert.equal(errors.length, 0, errors.map((entry) => entry[0]).join("\n"));
});
