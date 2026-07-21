import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const archive = process.argv[2] && path.resolve(process.argv[2]);
if (!archive) throw new Error("Usage: npm run restore -- <backup-path>");
await access(archive);
if (!stdin.isTTY) throw new Error("Restore requires an interactive terminal confirmation");
const prompt = readline.createInterface({ input: stdin, output: stdout });
const answer = await prompt.question("Type RESTORE to replace the current wardrobe data: ");
prompt.close();
if (answer !== "RESTORE") {
  console.log("Restore cancelled");
  process.exit(0);
}
const temporary = await mkdtemp(path.join(os.tmpdir(), "wardrobe-restore-"));
try {
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", temporary], { stdio: "inherit" });
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)));
  });
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(temporary));
  if (entries.length !== 1) throw new Error("Backup archive has an unexpected layout");
  const root = path.join(temporary, entries[0]);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (![1, 2, 3].includes(manifest.format) || manifest.containsSecrets !== false) throw new Error("Backup manifest is not accepted");
  const target = path.resolve(process.env.WARDROBE_DATA_DIR || "data");
  const dataSource = path.join(root, "data");
  if (await access(dataSource).then(() => true, () => false)) {
    await rm(target, { recursive: true, force: true });
    await cp(dataSource, target, { recursive: true });
    console.log(`Restored application data to ${target}`);
  }
  const privateSource = path.join(root, "private-storage");
  if ([2, 3].includes(manifest.format) && manifest.privateStorage === "external" && await access(privateSource).then(() => true, () => false)) {
    const privateTarget = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(target, "private"));
    await rm(privateTarget, { recursive: true, force: true });
    await cp(privateSource, privateTarget, { recursive: true });
    console.log(`Restored private image storage to ${privateTarget}`);
  }
  // The database dump (if present) is intentionally not auto-applied — restoring it can
  // clobber newer live data, so it needs its own deliberate step rather than happening
  // silently as part of this file-restore.
  const databaseDump = path.join(root, "database.sql");
  if (manifest.hasDatabaseDump && await access(databaseDump).then(() => true, () => false)) {
    console.log(`This backup also includes a database dump. It was NOT restored automatically.`);
    console.log(`To apply it manually: mysql --host=<host> --user=<user> -p <database> < ${databaseDump}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
