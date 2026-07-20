import "dotenv/config";
import mysql from "mysql2/promise";
import { loadConfig } from "../server/config.mjs";

const expectedTables = [
  "api_usage_daily",
  "app_settings",
  "generation_jobs",
  "import_jobs",
  "sessions",
  "wardrobe_assets",
  "wardrobe_items",
];
const expectedUsageColumns = [
  "analysis_requests",
  "analysis_succeeded",
  "analysis_failed",
  "image_requests",
  "image_succeeded",
  "image_failed",
];

const config = loadConfig({ ...process.env, NODE_ENV: "development" }, process.cwd());
if (!config.database) throw new Error("Configure DATABASE_URL or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD first");

const pool = mysql.createPool(config.database);
try {
  const [rows] = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  const present = new Set(rows.map((row) => row.TABLE_NAME || row.table_name));
  const missing = expectedTables.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Database is reachable, but migrations are missing: ${missing.join(", ")}`);
  const [columnRows] = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'api_usage_daily'",
  );
  const columns = new Set(columnRows.map((row) => row.COLUMN_NAME || row.column_name));
  const missingColumns = expectedUsageColumns.filter((name) => !columns.has(name));
  if (missingColumns.length) throw new Error(`Database is reachable, but usage outcome migration is missing: ${missingColumns.join(", ")}`);
  await pool.query("SELECT 1");
  console.log(`Database check passed: connection works, all ${expectedTables.length} application tables exist, and usage outcome columns are ready.`);
} finally {
  await pool.end();
}
