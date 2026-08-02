"use strict";

const { appendFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

// Passenger is free to launch this entry point from a directory other than the
// deployed application root. Keep dotenv and every relative production path
// anchored to the directory that actually contains this file.
const launchCwd = process.cwd();
process.chdir(__dirname);

const startupLogDirectory = path.join(__dirname, "tmp");
const startupLogPath = path.join(startupLogDirectory, "wardrobe-startup.log");

function diagnostic(event, details = {}) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    pid: process.pid,
    node: process.version,
    ...details,
  });
  try {
    mkdirSync(startupLogDirectory, { recursive: true, mode: 0o700 });
    appendFileSync(startupLogPath, `${record}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error("[wardrobe] could not write startup diagnostics", {
      code: error?.code,
      message: error?.message,
    });
  }
}

globalThis.__wardrobeStartupDiagnostic = diagnostic;

function logFatal(kind, error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  diagnostic(kind, {
    name: failure.name,
    message: failure.message,
    stack: failure.stack,
  });
  console.error(`[wardrobe] ${kind}`, {
    name: failure.name,
    message: failure.message,
    stack: failure.stack,
  });
}

process.on("uncaughtException", (error) => {
  logFatal("uncaught exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logFatal("unhandled rejection", error);
  process.exit(1);
});

diagnostic("passenger-bootstrap-loaded", { cwd: process.cwd(), launchCwd, applicationRoot: __dirname });
console.log(`[wardrobe] Passenger bootstrap loaded; diagnostics: ${startupLogPath}`);
import("./server/frontend-build.mjs")
  .then(({ ensureFrontendBuild }) => ensureFrontendBuild(__dirname, { onEvent: diagnostic }))
  .then(() => import("./server/index.mjs"))
  .catch((error) => {
    logFatal("startup failed", error);
    process.exit(1);
  });
