import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function runViteBuild(root) {
  const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteCli, "build"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`Frontend build failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

export async function ensureFrontendBuild(root, options = {}) {
  const entry = path.join(root, "dist", "index.html");
  try {
    await access(entry);
    options.onEvent?.("frontend-build-ready", { entry, builtAtStartup: false });
    return { entry, builtAtStartup: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  options.onEvent?.("frontend-build-missing", { entry });
  await (options.build || runViteBuild)(root);
  await access(entry);
  options.onEvent?.("frontend-build-ready", { entry, builtAtStartup: true });
  return { entry, builtAtStartup: true };
}
