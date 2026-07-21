import { runBackup } from "../scripts/backup.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

async function runOnce(env) {
  try {
    const result = await runBackup({ env });
    console.log("[wardrobe] scheduled-backup-complete", { archive: result.archive, hasDatabaseDump: result.hasDatabaseDump, pruned: result.pruned.length });
  } catch (error) {
    // A failed backup should never take the app down — log and try again on the next tick.
    console.error("[wardrobe] scheduled-backup-failed", { name: error.name, message: error.message });
  }
}

// Runs once ~5 minutes after boot (clear of startup) and then daily. Set
// WARDROBE_AUTO_BACKUP=false to disable (e.g. for local development).
export function scheduleBackups(env = process.env) {
  if (env.WARDROBE_AUTO_BACKUP === "false") return;
  setTimeout(() => {
    void runOnce(env);
    setInterval(() => void runOnce(env), DAY_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
