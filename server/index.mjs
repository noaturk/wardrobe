import "dotenv/config";
import { createServer } from "node:http";
import { loadConfig } from "./config.mjs";
import { createApp } from "./app.mjs";

const config = loadConfig(process.env, process.cwd());
const app = await createApp(config);
const server = createServer(app);

server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

server.listen(config.port, "0.0.0.0", () => {
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
