import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const KINDS = new Set(["analysis", "images"]);
const OUTCOMES = new Set(["requested", "succeeded", "failed"]);

function emptyCounter() {
  return { requested: 0, succeeded: 0, failed: 0 };
}

function normalizeCounter(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      requested: Number(value.requested || 0),
      succeeded: Number(value.succeeded || 0),
      failed: Number(value.failed || 0),
    };
  }
  // Older files stored only a total. Preserve it as requested without
  // pretending that historical HTTP responses were successful.
  return { requested: Number(value || 0), succeeded: 0, failed: 0 };
}

function normalizeDay(value = {}) {
  return {
    analysis: normalizeCounter(value.analysis),
    images: normalizeCounter(value.images),
  };
}

function addCounters(total, value) {
  for (const kind of KINDS) {
    for (const outcome of OUTCOMES) total[kind][outcome] += value[kind][outcome];
  }
  return total;
}

export class UsageStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  day(now = new Date()) {
    return now.toISOString().slice(0, 10);
  }

  async read() {
    try { return JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  }

  async write(value) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }

  async record(kind, outcome) {
    if (!KINDS.has(kind) || !OUTCOMES.has(outcome)) throw new Error("Invalid usage counter");
    let result;
    this.queue = this.queue.then(async () => {
      const usage = await this.read();
      const day = this.day();
      usage[day] = normalizeDay(usage[day]);
      usage[day][kind][outcome] += 1;
      await this.write(usage);
      result = usage[day];
    });
    await this.queue;
    return result;
  }

  async assertImageAllowed(limit) {
    if (Number(limit) <= 0) return 0;
    const usage = await this.read();
    const count = normalizeDay(usage[this.day()]).images.requested;
    if (count >= limit) throw Object.assign(new Error("Daily image generation limit reached"), { status: 429 });
    return count;
  }

  async summary() {
    const usage = await this.read();
    const today = normalizeDay(usage[this.day()]);
    const month = this.day().slice(0, 7);
    const monthly = Object.entries(usage)
      .filter(([day]) => day.startsWith(month))
      .reduce((total, [, value]) => addCounters(total, normalizeDay(value)), { analysis: emptyCounter(), images: emptyCounter() });
    return { today, monthly, date: this.day(), month };
  }
}

export class MySqlUsageStore {
  constructor(connectionOptions) {
    this.pool = mysql.createPool(connectionOptions);
  }

  day(now = new Date()) { return now.toISOString().slice(0, 10); }

  async record(kind, outcome) {
    const column = {
      analysis: { requested: "analysis_requests", succeeded: "analysis_succeeded", failed: "analysis_failed" },
      images: { requested: "image_requests", succeeded: "image_succeeded", failed: "image_failed" },
    }[kind]?.[outcome];
    if (!column) throw new Error("Invalid usage counter");
    await this.pool.execute(
      `INSERT INTO api_usage_daily (usage_date, ${column}) VALUES (?, 1) ON DUPLICATE KEY UPDATE ${column} = ${column} + 1`,
      [this.day()],
    );
  }

  async assertImageAllowed(limit) {
    if (Number(limit) <= 0) return 0;
    const [rows] = await this.pool.execute("SELECT image_requests FROM api_usage_daily WHERE usage_date = ? LIMIT 1", [this.day()]);
    const count = Number(rows[0]?.image_requests || 0);
    if (count >= limit) throw Object.assign(new Error("Daily image generation limit reached"), { status: 429 });
    return count;
  }

  async summary() {
    const day = this.day();
    const month = day.slice(0, 7);
    const fields = "analysis_requests AS analysis_requested, analysis_succeeded, analysis_failed, image_requests AS image_requested, image_succeeded, image_failed";
    const sums = "COALESCE(SUM(analysis_requests),0) AS analysis_requested, COALESCE(SUM(analysis_succeeded),0) AS analysis_succeeded, COALESCE(SUM(analysis_failed),0) AS analysis_failed, COALESCE(SUM(image_requests),0) AS image_requested, COALESCE(SUM(image_succeeded),0) AS image_succeeded, COALESCE(SUM(image_failed),0) AS image_failed";
    const [todayRows] = await this.pool.execute(`SELECT ${fields} FROM api_usage_daily WHERE usage_date = ?`, [day]);
    const [monthRows] = await this.pool.execute(`SELECT ${sums} FROM api_usage_daily WHERE DATE_FORMAT(usage_date, '%Y-%m') = ?`, [month]);
    const shape = (row = {}) => ({
      analysis: { requested: Number(row.analysis_requested || 0), succeeded: Number(row.analysis_succeeded || 0), failed: Number(row.analysis_failed || 0) },
      images: { requested: Number(row.image_requested || 0), succeeded: Number(row.image_succeeded || 0), failed: Number(row.image_failed || 0) },
    });
    return { today: shape(todayRows[0]), monthly: shape(monthRows[0]), date: day, month };
  }
}

export class Semaphore {
  constructor(limit = 1) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async run(task) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try { return await task(); }
    finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}
