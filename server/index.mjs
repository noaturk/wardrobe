import "dotenv/config";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createApp } from "./app.mjs";
import { scheduleBackups } from "./backup-schedule.mjs";

function startupStage(event, details = {}) {
  console.log(`[wardrobe] ${event}`, details);
  globalThis.__wardrobeStartupDiagnostic?.(event, details);
}

// Resolve from this module instead of the process working directory. Managed
// hosts such as Passenger may start Node elsewhere, which previously made the
// authenticated SPA look for dist/index.html in the wrong directory.
const applicationRoot = fileURLToPath(new URL("../", import.meta.url));
const launchCwd = globalThis.__wardrobeLaunchCwd || process.cwd();
startupStage("server-module-loaded", { cwd: process.cwd(), launchCwd, applicationRoot, node: process.version });
const config = loadConfig(process.env, applicationRoot, { relativeStorageRoot: launchCwd });
startupStage("configuration-loaded", {
  applicationRoot: config.root,
  production: config.production,
  port: config.port,
  storageDriver: config.storageDriver,
  storageFallbacks: config.localStorageFallbackDirs.length,
  databaseConfigured: Boolean(config.database),
});
startupStage("application-initializing");
const app = await createApp(config);
startupStage("application-initialized");
const server = createServer(app);

server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

server.listen(config.port, "0.0.0.0", () => {
  startupStage("server-listening", { port: config.port });
  console.log(`Private Wardrobe listening on port ${config.port}`);
});

scheduleBackups({
  ...process.env,
  WARDROBE_DATA_DIR: config.dataDir,
  LOCAL_STORAGE_DIR: config.localStorageDir,
  WARDROBE_BACKUP_DIR: config.backupDir,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing server`);
  server.close((error) => {
    if (error) {
      console.error("Server shutdown failed", { name: error.name });
      process.exit(1);
    }
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Without these, an error that escapes a fire-and-forget async task (e.g. a background
// image-generation job) crashes the entire process by default, taking down every request
// in flight until a supervisor restarts it. Log full detail and keep serving; a rejection
// in one background task should not take the whole app down for everyone.
process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection", { name: error?.name, message: error?.message, stack: error?.stack });
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", { name: error?.name, message: error?.message, stack: error?.stack });
});
