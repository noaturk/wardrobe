import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureFrontendBuild } from "../server/frontend-build.mjs";

test("keeps an existing frontend build without rebuilding it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-frontend-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.html"), "ready");
  let builds = 0;

  const result = await ensureFrontendBuild(root, { build: async () => { builds += 1; } });

  assert.equal(result.builtAtStartup, false);
  assert.equal(builds, 0);
});

test("creates a missing frontend build before server startup continues", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-frontend-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];

  const result = await ensureFrontendBuild(root, {
    onEvent: (event) => events.push(event),
    build: async (buildRoot) => {
      await mkdir(path.join(buildRoot, "dist"), { recursive: true });
      await writeFile(path.join(buildRoot, "dist", "index.html"), "built");
    },
  });

  assert.equal(result.builtAtStartup, true);
  assert.deepEqual(events, ["frontend-build-missing", "frontend-build-ready"]);
});

test("fails startup when a build command does not create its entry file", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wardrobe-frontend-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    ensureFrontendBuild(root, { build: async () => undefined }),
    (error) => error.code === "ENOENT",
  );
});
