import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import session from "express-session";
import { createApp } from "../server/app.mjs";
import { hashPassword } from "../server/password.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-occasion-"));
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
    openAIVisionModel: "gpt-5.4-mini",
    maxConcurrentOpenAIJobs: 1,
    dailyImageLimit: 2,
    openAITimeoutMs: 5000,
    maxUploadBytes: 1024 * 1024,
    maxImagePixels: 1000,
    dataDir: path.join(root, "data"),
    modelReference: path.join(root, "data", "reference.png"),
  };
  const app = await createApp(config, { sessionStore: new session.MemoryStore(), serveBuild: true, openAIRetryBaseMs: 1 });
  return { root, app };
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

function installFetchMock(t, bucket) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const body = { output_text: JSON.stringify(bucket) };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test("an unmatched description asks OpenAI once and is remembered afterwards", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t, { trigger: ["koncert", "concert"], boost: ["casual", "tenisice"], penalty: ["odijelo"] });
  const { agent, csrf } = await login(app);

  const first = await agent.post("/api/occasion-buckets/generate").set("X-CSRF-Token", csrf).send({ description: "idem na koncert" }).expect(201);
  assert.equal(first.body.matched, false);
  assert.deepEqual(first.body.bucket.trigger, ["koncert", "concert"]);
  assert.equal(first.body.bucket.source, "ai");
  assert.equal(calls.length, 1);

  const list = await agent.get("/api/occasion-buckets").expect(200);
  assert.equal(list.body.length, 1);

  const second = await agent.post("/api/occasion-buckets/generate").set("X-CSRF-Token", csrf).send({ description: "idem na koncert večeras" }).expect(200);
  assert.equal(second.body.matched, true);
  assert.equal(calls.length, 1, "a description matching an already-learned bucket must not call OpenAI again");
});

test("rejects an empty description without calling OpenAI", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t, { trigger: ["x"], boost: ["y"], penalty: [] });
  const { agent, csrf } = await login(app);
  await agent.post("/api/occasion-buckets/generate").set("X-CSRF-Token", csrf).send({ description: "   " }).expect(400);
  assert.equal(calls.length, 0);
});

test("a description that already matches a built-in bucket never calls OpenAI", async (t) => {
  const { root, app } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = installFetchMock(t, { trigger: ["x"], boost: ["y"], penalty: [] });
  const { agent, csrf } = await login(app);
  const response = await agent.post("/api/occasion-buckets/generate").set("X-CSRF-Token", csrf).send({ description: "poslovni sastanak" }).expect(200);
  assert.equal(response.body.matched, true);
  assert.equal(calls.length, 0);
});
