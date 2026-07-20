import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const connectionOptions = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };
if (!process.env.DATABASE_URL && !["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].every((name) => process.env[name])) {
  throw new Error("Configure DATABASE_URL or DB_HOST, DB_NAME, DB_USER and DB_PASSWORD");
}
const connection = await mysql.createConnection({ ...connectionOptions, multipleStatements: true });
try {
  await connection.query("CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB");
  const directory = path.resolve("migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const [rows] = await connection.execute("SELECT name FROM schema_migrations WHERE name = ?", [file]);
    if (rows.length) continue;
    const sql = await readFile(path.join(directory, file), "utf8");
    await connection.beginTransaction();
    try {
      await connection.query(sql);
      await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      await connection.commit();
      console.log(`Applied ${file}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
} finally {
  await connection.end();
}
