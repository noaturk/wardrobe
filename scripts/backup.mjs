import "dotenv/config";
import { access, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const source = path.resolve(process.env.WARDROBE_DATA_DIR || "data");
const storageDriver = process.env.STORAGE_DRIVER || "local";
const privateSource = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(source, "private"));
const backupRoot = path.resolve(process.env.WARDROBE_BACKUP_DIR || "backups");
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const staging = path.join(backupRoot, `wardrobe-${stamp}`);
await mkdir(staging, { recursive: true, mode: 0o700 });
const exists = (target) => access(target).then(() => true, () => false);
const copyPrivateTree = async (from, to) => {
  if (!await exists(from)) return false;
  await cp(from, to, {
    recursive: true,
    force: false,
    filter: (entry) => !/(^|[/\\])(?:\.env|sessions?|.*\.tmp)$/.test(entry),
  });
  return true;
};
const hasData = await copyPrivateTree(source, path.join(staging, "data"));
const privateInsideData = privateSource === source || privateSource.startsWith(`${source}${path.sep}`);
const hasExternalPrivateStorage = storageDriver === "local" && !privateInsideData
  ? await copyPrivateTree(privateSource, path.join(staging, "private-storage"))
  : false;
await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify({
  format: 2,
  createdAt: new Date().toISOString(),
  containsSecrets: false,
  hasData,
  privateStorage: storageDriver === "local" ? (hasExternalPrivateStorage ? "external" : "inside-data") : "provider-managed",
}, null, 2)}\n`, { mode: 0o600 });
const archive = `${staging}.tar.gz`;
await new Promise((resolve, reject) => {
  const child = spawn("tar", ["-czf", archive, "-C", backupRoot, path.basename(staging)], { stdio: "inherit" });
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)));
});
console.log(archive);
