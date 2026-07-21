import "dotenv/config";
import { access, mkdir, cp, writeFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const exists = (target) => access(target).then(() => true, () => false);

function databaseConnectionFromEnv(env) {
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    return {
      host: url.hostname,
      port: url.port || "3306",
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
    };
  }
  if (env.DB_HOST && env.DB_NAME && env.DB_USER) {
    return { host: env.DB_HOST, port: env.DB_PORT || "3306", user: env.DB_USER, password: env.DB_PASSWORD || "", database: env.DB_NAME };
  }
  return null;
}

async function dumpDatabase(connection, destination) {
  await new Promise((resolve, reject) => {
    const child = spawn("mysqldump", [
      "--host", connection.host,
      "--port", connection.port,
      "--user", connection.user,
      "--single-transaction",
      "--routines",
      "--result-file", destination,
      connection.database,
    ], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, MYSQL_PWD: connection.password } });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump exited with ${code}`))));
  });
}

async function copyPrivateTree(from, to) {
  if (!await exists(from)) return false;
  await cp(from, to, {
    recursive: true,
    force: false,
    filter: (entry) => !/(^|[/\\])(?:\.env|sessions?|.*\.tmp)$/.test(entry),
  });
  return true;
}

// Deletes older backup archives once more than `keep` exist, so an unattended daily backup
// can't quietly fill up the disk over months of running.
async function pruneOldBackups(backupRoot, keep) {
  const entries = await readdir(backupRoot).catch(() => []);
  const archives = entries.filter((name) => name.endsWith(".tar.gz"));
  if (archives.length <= keep) return [];
  const withStats = await Promise.all(archives.map(async (name) => ({ name, mtime: (await stat(path.join(backupRoot, name))).mtimeMs })));
  withStats.sort((first, second) => second.mtime - first.mtime);
  const toDelete = withStats.slice(keep);
  await Promise.all(toDelete.map(({ name }) => rm(path.join(backupRoot, name), { force: true })));
  return toDelete.map(({ name }) => name);
}

export async function runBackup({ env = process.env, keep = 7 } = {}) {
  const source = path.resolve(env.WARDROBE_DATA_DIR || "data");
  const storageDriver = env.STORAGE_DRIVER || "local";
  const privateSource = path.resolve(env.LOCAL_STORAGE_DIR || path.join(source, "private"));
  const backupRoot = path.resolve(env.WARDROBE_BACKUP_DIR || "backups");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const staging = path.join(backupRoot, `wardrobe-${stamp}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });

  const hasData = await copyPrivateTree(source, path.join(staging, "data"));
  const privateInsideData = privateSource === source || privateSource.startsWith(`${source}${path.sep}`);
  const hasExternalPrivateStorage = storageDriver === "local" && !privateInsideData
    ? await copyPrivateTree(privateSource, path.join(staging, "private-storage"))
    : false;

  // Production keeps its real data in MySQL (import_jobs, wardrobe_items, wardrobe_assets,
  // app_settings), not the local data dir above — without this, a "backup" on production
  // would archive almost nothing of substance. Object storage (S3-compatible) is assumed to
  // have its own provider-side durability and isn't copied here.
  const connection = databaseConnectionFromEnv(env);
  let hasDatabaseDump = false;
  let databaseDumpError = null;
  if (connection) {
    try {
      await dumpDatabase(connection, path.join(staging, "database.sql"));
      hasDatabaseDump = true;
    } catch (error) {
      databaseDumpError = error.message;
      console.error("Database dump failed, continuing with the rest of the backup", { message: error.message });
    }
  }

  await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify({
    format: 3,
    createdAt: new Date().toISOString(),
    containsSecrets: false,
    hasData,
    hasDatabaseDump,
    databaseDumpError,
    privateStorage: storageDriver === "local" ? (hasExternalPrivateStorage ? "external" : "inside-data") : "provider-managed (not copied by this backup)",
  }, null, 2)}\n`, { mode: 0o600 });

  const archive = `${staging}.tar.gz`;
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-czf", archive, "-C", backupRoot, path.basename(staging)], { stdio: "inherit" });
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
  });
  await rm(staging, { recursive: true, force: true });
  const pruned = await pruneOldBackups(backupRoot, keep);

  return { archive, hasData, hasDatabaseDump, databaseDumpError, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runBackup();
  console.log(result.archive);
  if (result.databaseDumpError) console.error(`Warning: database dump failed (${result.databaseDumpError}) — backup only contains local files.`);
  if (result.pruned.length) console.log(`Pruned ${result.pruned.length} old backup(s): ${result.pruned.join(", ")}`);
}
