import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { verifyPassword } from "./password.mjs";
import { verifyTotp } from "./totp.mjs";
import { sanitizeImage } from "./images.mjs";
import { MySqlUsageStore, UsageStore, Semaphore } from "./usage.mjs";
import { createStorage } from "./storage.mjs";
import { MySqlWardrobeRepository } from "./repository.mjs";
import { createOutfitRouter } from "./outfits.mjs";
import { wardrobeImportApi } from "../scripts/import-job-api.mjs";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function loginPage({ csrfToken, error = "", nonce, totpEnabled = false }) {
  return `<!doctype html><html lang="hr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Noa's Wardrobe — prijava</title>
  <style nonce="${nonce}">:root{--ink:#111111;--muted:#6b7280;--line:#e5e7eb;--shadow:0 1px 2px rgba(0,0,0,.04);--radius:12px;color-scheme:light}*{box-sizing:border-box}html{background:#fff}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:var(--ink);font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background-color:#fff;background-image:radial-gradient(circle,rgba(0,0,0,.05) 1px,transparent 1px);background-size:30px 30px}.card{width:min(430px,100%);background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:clamp(1.5rem,5vw,3rem);box-shadow:var(--shadow)}.eyebrow{margin:0 0 .35rem;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}h1{margin:.2em 0 0;font-family:Poppins,sans-serif;font-size:2.3rem;font-weight:600;letter-spacing:-.02em}h1::after{content:"";display:block;width:54px;margin-top:.5rem;border-bottom:2px solid var(--line)}p{margin:.9rem 0 0;color:var(--muted);line-height:1.5}label{display:grid;gap:.4rem;margin-top:18px;font-size:.88rem;font-weight:700}input{font:inherit;padding:13px 14px;border:1px solid #cfcfc7;border-radius:9px;background:#fff;color:var(--ink)}input:hover{border-color:#aaa99f}input:focus{outline:3px solid rgba(17,17,17,.25);outline-offset:2px;border-color:#111}button{width:100%;margin-top:24px;min-height:42px;padding:13px;border:1px solid var(--ink);border-radius:.5rem;background:var(--ink);color:#fff;font:600 .92rem/1 Poppins,sans-serif;cursor:pointer}button:hover{background:#262626}button:focus-visible{outline:3px solid rgba(17,17,17,.25);outline-offset:2px}.error{margin-top:.9rem;color:#b91c1c;background:#fee2e2;padding:10px 12px;border-radius:9px;font-size:.86rem}</style></head>
  <body><main class="card"><p class="eyebrow">Privatni portfolio</p><h1>Noa's Wardrobe</h1><p>Ova garderoba dostupna je samo vlasniku.</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/auth/login"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><label>Korisničko ime<input name="username" autocomplete="username" required autofocus></label><label>Lozinka<input type="password" name="password" autocomplete="current-password" required></label>${totpEnabled ? '<label>Jednokratni kod<input name="totp" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required></label>' : ""}<button type="submit">Prijavi se</button></form></main></body></html>`;
}

class MySqlSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sessionId, callback) {
    this.pool.execute("SELECT data, expires FROM sessions WHERE session_id = ? LIMIT 1", [sessionId]).then(async ([rows]) => {
      const row = rows[0];
      if (!row || Number(row.expires) <= Math.floor(Date.now() / 1000)) {
        if (row) await this.pool.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    }).catch(callback);
  }

  set(sessionId, value, callback = () => {}) {
    const expires = value.cookie?.expires
      ? Math.floor(new Date(value.cookie.expires).getTime() / 1000)
      : Math.floor((Date.now() + Number(value.cookie?.maxAge || 43_200_000)) / 1000);
    this.pool.execute(
      "INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)",
      [sessionId, expires, JSON.stringify(value)],
    ).then(() => callback()).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId]).then(() => callback()).catch(callback);
  }

  touch(sessionId, value, callback = () => {}) {
    const expires = value.cookie?.expires
      ? Math.floor(new Date(value.cookie.expires).getTime() / 1000)
      : Math.floor((Date.now() + Number(value.cookie?.maxAge || 43_200_000)) / 1000);
    this.pool.execute("UPDATE sessions SET expires = ? WHERE session_id = ?", [expires, sessionId]).then(() => callback()).catch(callback);
  }
}

async function createSessionStore(config) {
  if (!config.production || !config.database) return new session.MemoryStore();
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool(config.database);
  return new MySqlSessionStore(pool);
}

function isStateChanging(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

function originGuard(config) {
  return (req, res, next) => {
    if (!isStateChanging(req.method)) return next();
    const allowedOrigins = new Set([config.appOrigin.origin]);
    if (!config.production) {
      allowedOrigins.add(`http://localhost:${config.port}`);
      allowedOrigins.add(`http://127.0.0.1:${config.port}`);
      allowedOrigins.add(`http://[::1]:${config.port}`);
    }
    const isAllowed = (value) => {
      if (allowedOrigins.has(value)) return true;
      if (config.production) return false;
      if (value === "null") return true;
      try {
        const candidate = new URL(value);
        const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "terminal.local"]);
        return ["http:", "https:"].includes(candidate.protocol)
          && localHosts.has(candidate.hostname)
          && (!candidate.port || candidate.port === String(config.port));
      } catch {
        return false;
      }
    };
    const origin = req.get("origin");
    if (origin && !isAllowed(origin)) {
      if (!config.production) console.warn("Rejected development origin", { origin });
      return res.status(403).json({ error: "Origin is not allowed" });
    }
    const referer = req.get("referer");
    if (!origin && referer) {
      try { if (!isAllowed(new URL(referer).origin)) return res.status(403).json({ error: "Origin is not allowed" }); }
      catch { return res.status(403).json({ error: "Origin is not allowed" }); }
    }
    return next();
  };
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return res.status(401).json({ error: "Authentication required" });
  return res.status(401).type("html").send(loginPage({ csrfToken: req.session.csrfToken, nonce: res.locals.cspNonce }));
}

function requireCsrf(req, res, next) {
  if (!isStateChanging(req.method)) return next();
  const supplied = req.get("x-csrf-token");
  const expected = req.session?.csrfToken;
  if (supplied && expected) {
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes)) return next();
  }
  return res.status(403).json({ error: "Invalid CSRF token" });
}

export async function createApp(config, options = {}) {
  const startupStage = (event, details = {}) => globalThis.__wardrobeStartupDiagnostic?.(event, details);
  const app = express();
  startupStage("session-store-initializing");
  const sessionStore = options.sessionStore || await createSessionStore(config);
  startupStage("session-store-initialized");
  const usage = options.usageStore || (config.production && config.database
    ? new MySqlUsageStore(config.database)
    : new UsageStore(path.join(config.dataDir, "usage.json")));
  const privateStorage = options.storage || (config.localStorageDir || config.storageDriver === "s3" ? createStorage(config) : null);
  const metadataStore = options.metadataStore || (config.production && config.database ? new MySqlWardrobeRepository(config.database) : null);
  const openAISemaphore = new Semaphore(config.maxConcurrentOpenAIJobs);
  const recordOpenAIAttempt = options.recordOpenAIAttempt || ((event) => console.info("openai_request_attempt", JSON.stringify(event)));
  startupStage("data-directory-initializing", { path: config.dataDir });
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  startupStage("data-directory-initialized");
  if (config.storageDriver === "local" && config.localStorageDir) {
    startupStage("local-storage-initializing", { path: config.localStorageDir });
    await mkdir(config.localStorageDir, { recursive: true, mode: 0o700 });
    startupStage("local-storage-initialized");
  }

  if (config.trustProxy !== false) app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(18).toString("base64");
    next();
  });
  app.use(helmet({
    // Browsers may serialize the Origin header as "null" for an HTML form
    // submitted from a document served with `no-referrer`. Keep same-origin
    // navigation context so the origin guard can validate the login POST.
    referrerPolicy: { policy: "same-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", "blob:", "data:"],
        scriptSrc: ["'self'", ...(!config.production ? ["'unsafe-inline'"] : [])],
        styleSrc: config.production
          ? ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`]
          : ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "https://api.open-meteo.com", ...(!config.production ? ["ws:", "wss:"] : [])],
        manifestSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }));
  app.use((req, res, next) => {
    const host = req.get("host");
    const allowed = new Set([config.appOrigin.host, `localhost:${config.port}`, "127.0.0.1"]);
    if (config.production && !allowed.has(host)) return res.status(400).send("Invalid host");
    return next();
  });
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.use(session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      maxAge: config.sessionTtlMs,
      path: "/",
    },
  }));
  app.use((req, _res, next) => {
    req.session.csrfToken ||= crypto.randomBytes(32).toString("base64url");
    next();
  });
  app.use(originGuard(config));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => res.status(429).type("html").send("Previše pokušaja prijave. Pokušajte ponovno kasnije."),
  });
  app.get("/auth/login", (req, res) => {
    res.set("Cache-Control", "private, no-store");
    if (req.session.authenticated) return res.redirect("/");
    return res.status(200).type("html").send(loginPage({ csrfToken: req.session.csrfToken, nonce: res.locals.cspNonce, totpEnabled: Boolean(config.adminTotpSecret) }));
  });
  app.post("/auth/login", loginLimiter, express.urlencoded({ extended: false, limit: "8kb" }), async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const csrfValid = typeof req.body._csrf === "string" && req.body._csrf === req.session.csrfToken;
    const usernameValid = typeof req.body.username === "string"
      && crypto.timingSafeEqual(Buffer.from(req.body.username.padEnd(Math.max(req.body.username.length, config.adminUsername.length), "\0")), Buffer.from(config.adminUsername.padEnd(Math.max(req.body.username.length, config.adminUsername.length), "\0")));
    const passwordValid = await verifyPassword(String(req.body.password || ""), config.adminPasswordHash);
    const totpValid = !config.adminTotpSecret || verifyTotp(req.body.totp, config.adminTotpSecret);
    if (!csrfValid || !usernameValid || !passwordValid || !totpValid) {
      const attempts = (req.session.failedAttempts || 0) + 1;
      req.session.failedAttempts = attempts;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 150 * attempts)));
      return res.status(401).type("html").send(loginPage({ csrfToken: req.session.csrfToken, error: "Pogrešno korisničko ime, lozinka ili kod.", nonce: res.locals.cspNonce, totpEnabled: Boolean(config.adminTotpSecret) }));
    }
    return req.session.regenerate((error) => {
      if (error) return res.status(500).send("Login failed");
      req.session.authenticated = true;
      req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
      return req.session.save(() => res.redirect("/"));
    });
  });

  app.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  app.use(requireAuth);
  app.get("/api/auth/session", (req, res) => res.json({ authenticated: true, csrfToken: req.session.csrfToken, username: config.adminUsername }));
  app.post("/api/auth/logout", requireCsrf, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(config.sessionCookieName, { path: "/", httpOnly: true, secure: config.production, sameSite: "strict" });
      res.status(204).end();
    });
  });

  app.get("/api/usage", async (_req, res, next) => {
    try { res.json({ ...(await usage.summary()), dailyImageLimit: config.dailyImageLimit, imageLimitEnabled: config.dailyImageLimit > 0, note: "Procjena aplikacije; OpenAI Billing je konačni izvor potrošnje." }); }
    catch (error) { next(error); }
  });

  const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const outfitRouter = createOutfitRouter({
    dataDir: config.dataDir,
    storage: privateStorage,
    metadataStore,
    usage,
    semaphore: openAISemaphore,
    dailyImageLimit: config.dailyImageLimit,
    openAIKey: config.openAIKey,
    openAIBaseUrl: config.openAIBaseUrl,
    openAITimeoutMs: config.openAITimeoutMs,
    imageModel: config.openAIImageModel,
    imageQuality: config.openAIImageQuality,
    generateLimiter: uploadLimiter,
    maxUploadBytes: config.maxUploadBytes,
    maxImagePixels: config.maxImagePixels,
    openAIRetryBaseMs: options.openAIRetryBaseMs,
    recordOpenAIAttempt: (event) => recordOpenAIAttempt({ source: "outfit", ...event }),
  });
  app.use("/api/outfits", (req, res, next) => isStateChanging(req.method) ? requireCsrf(req, res, next) : next());
  app.use(outfitRouter);
  app.put("/api/settings/model-reference", uploadLimiter, requireCsrf, express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: config.maxUploadBytes,
  }), async (req, res, next) => {
    try {
      const sanitized = await sanitizeImage(req.body, { maxBytes: config.maxUploadBytes, maxPixels: config.maxImagePixels });
      if (privateStorage) await privateStorage.put("settings/model-reference.png", sanitized.bytes, "image/png");
      else {
        await mkdir(path.dirname(config.modelReference), { recursive: true, mode: 0o700 });
        await writeFile(config.modelReference, sanitized.bytes, { mode: 0o600 });
      }
      res.status(200).json({ stored: true });
    } catch (error) { next(error); }
  });
  app.delete("/api/settings/model-reference", requireCsrf, async (_req, res, next) => {
    try {
      if (privateStorage) await privateStorage.delete("settings/model-reference.png");
      else await rm(config.modelReference, { force: true });
      res.status(204).end();
    }
    catch (error) { next(error); }
  });

  app.get("/api/export", async (_req, res, next) => {
    try {
      const library = metadataStore
        ? await metadataStore.loadImported()
        : JSON.parse(await readFile(path.join(config.dataDir, "library.json"), "utf8").catch((error) => error.code === "ENOENT" ? "[]" : Promise.reject(error)));
      res.set({ "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="wardrobe-export-${new Date().toISOString().slice(0, 10)}.json"` });
      res.json({ version: 1, exportedAt: new Date().toISOString(), wardrobe: library });
    } catch (error) { next(error); }
  });

  const importApi = wardrobeImportApi({
    env: {
      ...process.env,
      WARDROBE_DATA_DIR: config.dataDir,
      WARDROBE_MODEL_REFERENCE: config.modelReference,
      OPENAI_API_BASE_URL: config.openAIBaseUrl,
      OPENAI_API_KEY: config.openAIKey,
    },
    maxUploadBytes: config.maxUploadBytes,
    maxImagePixels: config.maxImagePixels,
    beforeOpenAI: async (kind) => {
      if (kind === "images") await usage.assertImageAllowed(config.dailyImageLimit);
    },
    recordOpenAI: (kind, outcome) => usage.record(kind, outcome),
    recordOpenAIAttempt: (event) => recordOpenAIAttempt({ source: "import", ...event }),
    runOpenAI: (task) => openAISemaphore.run(task),
    openAITimeoutMs: config.openAITimeoutMs,
    openAIRetryBaseMs: options.openAIRetryBaseMs,
    storage: privateStorage,
    metadataStore,
    modelReferenceStorageKey: "settings/model-reference.png",
  });
  startupStage("import-api-initializing");
  await importApi.initialize(config.root);
  startupStage("import-api-initialized");
  app.delete("/api/data/wardrobe", requireCsrf, async (req, res, next) => {
    if (req.get("x-confirm-action") !== "DELETE WARDROBE") return res.status(400).json({ error: "Explicit confirmation is required" });
    try {
      if (metadataStore) {
        const keys = await metadataStore.deleteAll();
        await Promise.all(keys.map((key) => privateStorage?.delete(key)));
      }
      await Promise.all([
        rm(path.join(config.dataDir, "library.json"), { force: true }),
        rm(path.join(config.dataDir, "outfits.json"), { force: true }),
        rm(path.join(config.dataDir, "imported"), { recursive: true, force: true }),
        rm(path.join(config.dataDir, "jobs"), { recursive: true, force: true }),
      ]);
      await Promise.all([
        privateStorage?.deletePrefix("wardrobe"),
        privateStorage?.deletePrefix("jobs"),
        privateStorage?.deletePrefix("outfits"),
      ]);
      await Promise.all([
        mkdir(path.join(config.dataDir, "imported"), { recursive: true, mode: 0o700 }),
        mkdir(path.join(config.dataDir, "jobs"), { recursive: true, mode: 0o700 }),
      ]);
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/api/maintenance/cleanup", requireCsrf, async (_req, res, next) => {
    try {
      if (metadataStore) {
        const ids = await metadataStore.oldJobIds(new Date(Date.now() - (24 * 60 * 60 * 1000)));
        await Promise.all(ids.map(async (id) => {
          await metadataStore.deleteJob(id);
          await privateStorage?.deletePrefix(`jobs/${id}`);
        }));
        return res.json({ deleted: ids.length });
      }
      const jobsDirectory = path.join(config.dataDir, "jobs");
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(jobsDirectory).catch(() => []);
      const cutoff = Date.now() - (24 * 60 * 60 * 1000);
      let deleted = 0;
      for (const entry of entries) {
        if (!/^[a-f0-9-]{36}$/i.test(entry)) continue;
        const target = path.join(jobsDirectory, entry);
        const details = await stat(target);
        if (details.mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
          deleted += 1;
        }
      }
      res.json({ deleted });
    } catch (error) { next(error); }
  });
  app.use("/api/import", (req, res, next) => isStateChanging(req.method) ? uploadLimiter(req, res, next) : next());
  app.use("/api/import", (req, res, next) => isStateChanging(req.method) ? requireCsrf(req, res, next) : next());
  app.use(importApi.handler);

  if (config.production || options.serveBuild) {
    const dist = path.join(config.root, "dist");
    app.use(express.static(dist, { index: false, etag: true, maxAge: 0, setHeaders: (res) => res.setHeader("Cache-Control", "private, no-store") }));
    app.get("/{*path}", async (_req, res, next) => {
      try { res.set("Cache-Control", "private, no-store").sendFile(path.join(dist, "index.html")); }
      catch (error) { next(error); }
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use((error, _req, res, _next) => {
    const status = error.status || error.statusCode || (error.type === "entity.too.large" ? 413 : 500);
    if (status >= 500) console.error("Request failed", { name: error.name, status });
    res.status(status).json({ error: status >= 500 && config.production ? "Internal server error" : error.message });
  });
  return app;
}
