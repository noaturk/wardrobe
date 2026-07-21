import "dotenv/config";
import { createServer } from "node:http";
import { loadConfig } from "./config.mjs";
import { createApp } from "./app.mjs";

function startupStage(event, details = {}) {
  console.log(`[wardrobe] ${event}`, details);
  globalThis.__wardrobeStartupDiagnostic?.(event, details);
}

startupStage("server-module-loaded", { cwd: process.cwd(), node: process.version });
const config = loadConfig(process.env, process.cwd());
startupStage("configuration-loaded", {
  production: config.production,
  port: config.port,
  storageDriver: config.storageDriver,
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
