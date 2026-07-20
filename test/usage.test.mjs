import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Semaphore, UsageStore } from "../server/usage.mjs";

test("daily image limit is enforced by the server store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wardrobe-usage-"));
  try {
    const usage = new UsageStore(path.join(directory, "usage.json"));
    await usage.assertImageAllowed(2);
    await usage.record("images", "requested");
    await usage.assertImageAllowed(2);
    await usage.record("images", "requested");
    await assert.rejects(() => usage.assertImageAllowed(2), /Daily image generation limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("zero disables the app-level daily image limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wardrobe-usage-unlimited-"));
  try {
    const usage = new UsageStore(path.join(directory, "usage.json"));
    await usage.record("images", "requested");
    await usage.record("images", "failed");
    await usage.assertImageAllowed(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requested, succeeded and failed outcomes are reported separately", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wardrobe-usage-outcomes-"));
  try {
    const usage = new UsageStore(path.join(directory, "usage.json"));
    await usage.record("analysis", "requested");
    await usage.record("analysis", "succeeded");
    await usage.record("images", "requested");
    await usage.record("images", "failed");
    const summary = await usage.summary();
    assert.deepEqual(summary.today.analysis, { requested: 1, succeeded: 1, failed: 0 });
    assert.deepEqual(summary.today.images, { requested: 1, succeeded: 0, failed: 1 });
    assert.deepEqual(summary.monthly, summary.today);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OpenAI semaphore bounds active jobs", async () => {
  const semaphore = new Semaphore(1);
  let active = 0;
  let maximum = 0;
  const task = () => semaphore.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  });
  await Promise.all([task(), task(), task()]);
  assert.equal(maximum, 1);
});
