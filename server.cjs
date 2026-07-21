"use strict";

function logFatal(kind, error) {
  const failure = error instanceof Error ? error : new Error(String(error));
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

console.log("[wardrobe] Passenger bootstrap loaded");
import("./server/index.mjs").catch((error) => {
  logFatal("startup failed", error);
  process.exit(1);
});
