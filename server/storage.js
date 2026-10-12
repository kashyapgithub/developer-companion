/**
 * storage.js
 * --------------------------------------------------------------------------
 * Persistent storage layer for Developer Companion:
 *   - Sketches: JSON wireframe + PNG preview
 *   - SQLite: Centralized logs database & remote command queue
 *   - GitHub: Synced repository catalog & summaries
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { getStoreDir } from "./config.js";

// Legacy directories for seamless backward compatibility
const LEGACY_SKETCH_DIR = path.join(os.homedir(), ".ui-sketch-mcp");

export function getSketchJsonPath() {
  return path.join(getStoreDir(), "latest-sketch.json");
}

export function getSketchPngPath() {
  return path.join(getStoreDir(), "latest-sketch.png");
}

export function getGitHubContextPath() {
  return path.join(getStoreDir(), "github-context.json");
}

export function getDbPath() {
  return process.env.LOG_DB_PATH || path.join(getStoreDir(), "logs.db");
}

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    const dbPath = getDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbInstance = new DatabaseSync(dbPath);
    initDb(dbInstance);
  }
  return dbInstance;
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at      TEXT NOT NULL,
      app_name        TEXT NOT NULL,
      environment     TEXT NOT NULL DEFAULT 'production',
      host            TEXT,
      level           TEXT NOT NULL DEFAULT 'info',
      message         TEXT NOT NULL,
      error_type      TEXT,
      stack_trace     TEXT,
      context         TEXT NOT NULL DEFAULT '{}',
      fingerprint     TEXT,
      source_file     TEXT,
      source_line     INTEGER,
      source_function TEXT,
      request_id      TEXT,
      session_id      TEXT,
      user_ref        TEXT,
      tags            TEXT NOT NULL DEFAULT '[]',
      duration_ms     REAL,
      resolved        INTEGER NOT NULL DEFAULT 0,
      resolved_at     TEXT,
      resolved_note   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_app_time ON logs (app_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level);
    CREATE INDEX IF NOT EXISTS idx_logs_fingerprint ON logs (fingerprint);
    CREATE INDEX IF NOT EXISTS idx_logs_request ON logs (request_id);

    CREATE TABLE IF NOT EXISTS commands (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL,
      app_name      TEXT,
      command       TEXT NOT NULL,
      payload       TEXT NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'pending',
      result        TEXT,
      completed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commands_pending ON commands (status);
  `);
}

// ---------------------------------------------------------------------------
// Sketch Storage
// ---------------------------------------------------------------------------
export function writeSketch({ json, pngBase64 }) {
  const dir = getStoreDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getSketchJsonPath(), JSON.stringify(json, null, 2), "utf8");
  if (pngBase64) {
    fs.writeFileSync(getSketchPngPath(), Buffer.from(pngBase64, "base64"));
  }
}

export function readSketch() {
  const primaryJson = getSketchJsonPath();
  const primaryPng = getSketchPngPath();

  if (fs.existsSync(primaryJson)) {
    const json = JSON.parse(fs.readFileSync(primaryJson, "utf8"));
    const pngBase64 = fs.existsSync(primaryPng) ? fs.readFileSync(primaryPng).toString("base64") : null;
    return { json, pngBase64 };
  }

  // Fallback to legacy ui-sketch-mcp directory
  const legacyJson = path.join(LEGACY_SKETCH_DIR, "latest.json");
  const legacyPng = path.join(LEGACY_SKETCH_DIR, "latest.png");
  try {
    if (fs.existsSync(legacyJson)) {
      const json = JSON.parse(fs.readFileSync(legacyJson, "utf8"));
      const pngBase64 = fs.existsSync(legacyPng) ? fs.readFileSync(legacyPng).toString("base64") : null;
      return { json, pngBase64 };
    }
  } catch {}

  return null;
}

// ---------------------------------------------------------------------------
// GitHub Context Storage
// ---------------------------------------------------------------------------
export function writeGitHubContext(data) {
  const dir = getStoreDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getGitHubContextPath(), JSON.stringify(data, null, 2), "utf8");
}

export function readGitHubContext() {
  const p = getGitHubContextPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logs Storage & Queries
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Recording screenshots
// ---------------------------------------------------------------------------
/** Where a recording's screenshots live: <store>/shots/<session>/. */
export function shotsDir(sessionId) {
  return path.join(getStoreDir(), "shots", String(sessionId).replace(/[^\w.-]/g, "_"));
}

/**
 * Screenshots arrive as data URLs inside a log row's context. Keeping them in
 * the SQLite row would bloat every query, so they are written to disk and the
 * row keeps only `screenshot_file` (a path relative to the shots folder).
 */
function stashScreenshot(ctx, sessionId) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/s.exec(ctx?.screenshot || "");
  if (!m || !sessionId) return ctx;
  const dir = shotsDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${fs.readdirSync(dir).length}.${m[1] === "jpeg" ? "jpg" : "png"}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], "base64"));
  const { screenshot, ...rest } = ctx;
  return { ...rest, screenshot_file: name };
}

/** Reads one stored screenshot back as { data (base64), mimeType }, or null. */
export function readScreenshot(sessionId, name) {
  try {
    const file = path.join(shotsDir(sessionId), path.basename(name));
    return { data: fs.readFileSync(file).toString("base64"), mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg" };
  } catch { return null; }
}

export function insertLogs(rows) {
  const db = getDb();
  const list = Array.isArray(rows) ? rows : [rows];
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO logs (
      created_at, app_name, environment, host, level, message, error_type,
      stack_trace, context, fingerprint, source_file, source_line,
      source_function, request_id, session_id, user_ref, tags, duration_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  for (const r of list) {
    const ctxObj = typeof r.context === "object" && r.context ? stashScreenshot(r.context, r.session_id) : r.context;
    const ctx = typeof ctxObj === "object" ? JSON.stringify(ctxObj) : String(ctxObj || "{}");
    const tags = Array.isArray(r.tags) ? JSON.stringify(r.tags) : String(r.tags || "[]");

    insert.run(
      r.created_at || now,
      r.app_name || "unknown-app",
      r.environment || "production",
      r.host || null,
      (r.level || "info").toLowerCase(),
      r.message || "",
      r.error_type || null,
      r.stack_trace || null,
      ctx,
      r.fingerprint || null,
      r.source_file || null,
      r.source_line || null,
      r.source_function || null,
      r.request_id || null,
      r.session_id || null,
      r.user_ref || null,
      tags,
      r.duration_ms || null
    );
  }

  return list.length;
}

export function queryRecentLogs({ app, level, minutes = 60, limit = 100 } = {}) {
  const db = getDb();
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  let query = "SELECT * FROM logs WHERE created_at >= ?";
  const params = [since];

  if (app) {
    query += " AND app_name = ?";
    params.push(app);
  }
  if (level) {
    query += " AND level = ?";
    params.push(level.toLowerCase());
  }

  query += " ORDER BY id DESC LIMIT ?";
  params.push(Number(limit) || 100);

  const rows = db.prepare(query).all(...params);
  return rows.map(formatLogRow);
}

export function queryLogGroups({ limit = 20 } = {}) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      fingerprint,
      app_name,
      level,
      error_type,
      message,
      COUNT(*) AS total_count,
      MAX(created_at) AS last_seen,
      MIN(created_at) AS first_seen
    FROM logs
    WHERE fingerprint IS NOT NULL
    GROUP BY fingerprint, app_name, level
    ORDER BY total_count DESC, last_seen DESC
    LIMIT ?
  `).all(Number(limit) || 20);

  return rows;
}

export function queryLogTrace(requestId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM logs WHERE request_id = ? ORDER BY id ASC
  `).all(requestId);

  return rows.map(formatLogRow);
}

// ---------------------------------------------------------------------------
// Recording sessions
// A "recording" is a run of logs the extension captured between Record and
// Stop. Every row carries the same session_id (always prefixed "rec-").
// ---------------------------------------------------------------------------
const REC_PREFIX = "rec-%";

/** Newest recording's session id, or null if none has been sent yet. */
export function latestRecordingId() {
  const row = getDb().prepare(
    "SELECT session_id FROM logs WHERE session_id LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(REC_PREFIX);
  return row ? row.session_id : null;
}

/** Counts and timing for one recording — small enough to always show the agent. */
export function summarizeRecording(sessionId) {
  const db = getDb();
  const span = db.prepare(
    "SELECT COUNT(*) AS total, MIN(created_at) AS started, MAX(created_at) AS ended FROM logs WHERE session_id = ?"
  ).get(sessionId);
  if (!span || !span.total) return null;

  const byLevel = Object.fromEntries(
    db.prepare("SELECT level, COUNT(*) AS n FROM logs WHERE session_id = ? GROUP BY level").all(sessionId).map((r) => [r.level, r.n])
  );
  const byApp = Object.fromEntries(
    db.prepare("SELECT app_name, COUNT(*) AS n FROM logs WHERE session_id = ? GROUP BY app_name").all(sessionId).map((r) => [r.app_name, r.n])
  );
  // The same error repeated 200 times is one problem, not 200: group by message.
  const topErrors = db.prepare(`
    SELECT message, error_type, COUNT(*) AS count, MIN(created_at) AS first_seen
    FROM logs WHERE session_id = ? AND level IN ('error','fatal')
    GROUP BY message, error_type ORDER BY count DESC, first_seen ASC LIMIT 10
  `).all(sessionId);
  const markers = db.prepare(
    "SELECT created_at, message FROM logs WHERE session_id = ? AND tags LIKE '%\"marker\"%' ORDER BY id ASC"
  ).all(sessionId);

  return {
    session_id: sessionId,
    started: span.started,
    ended: span.ended,
    duration_seconds: Math.round((Date.parse(span.ended) - Date.parse(span.started)) / 1000),
    total_events: span.total,
    by_level: byLevel,
    by_site: byApp,
    top_errors: topErrors,
    markers,
  };
}

/**
 * Rows of one recording, oldest first.
 * verbosity "problems" = errors, warnings and markers only (what an agent
 * usually needs); "all" = everything, including routine requests.
 */
export function queryRecording(sessionId, { verbosity = "problems", limit = 200 } = {}) {
  const where = verbosity === "all"
    ? "session_id = ?"
    : "session_id = ? AND (level IN ('error','fatal','warn') OR tags LIKE '%\"marker\"%' OR tags LIKE '%\"timeline\"%' OR tags LIKE '%\"screenshot\"%')";
  const rows = getDb().prepare(
    `SELECT * FROM logs WHERE ${where} ORDER BY id ASC LIMIT ?`
  ).all(sessionId, Math.min(Number(limit) || 200, 2000));
  return rows.map(formatLogRow);
}

function formatLogRow(r) {
  const row = { ...r };
  try { row.context = JSON.parse(row.context); } catch {}
  try { row.tags = JSON.parse(row.tags); } catch {}
  return row;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
export function insertCommand({ app_name, command, payload = {} }) {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO commands (created_at, app_name, command, payload, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(now, app_name || null, command, JSON.stringify(payload));
  return { id: res.lastInsertRowid, status: "pending" };
}

export function getPendingCommands(appName) {
  const db = getDb();
  let query = "SELECT * FROM commands WHERE status = 'pending'";
  const params = [];
  if (appName) {
    query += " AND (app_name IS NULL OR app_name = ?)";
    params.push(appName);
  }
  query += " ORDER BY id ASC";
  const rows = db.prepare(query).all(...params);
  return rows.map((r) => {
    let payload = {};
    try { payload = JSON.parse(r.payload); } catch {}
    return { ...r, payload };
  });
}

export function getCommand(id) {
  const row = getDb().prepare("SELECT * FROM commands WHERE id = ?").get(id);
  if (!row) return null;
  let result = null;
  try { result = row.result ? JSON.parse(row.result) : null; } catch { result = row.result; }
  return { ...row, result };
}

/**
 * Hands pending commands to the extension AND marks them 'running' in one step,
 * so a second poll can never receive (and execute) the same command twice.
 */
export function claimPendingCommands(appName) {
  const pending = getPendingCommands(appName);
  const mark = getDb().prepare("UPDATE commands SET status = 'running' WHERE id = ? AND status = 'pending'");
  return pending.filter((c) => mark.run(c.id).changes > 0);
}

export function updateCommand(id, status, result) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE commands
    SET status = ?, result = ?, completed_at = ?
    WHERE id = ?
  `).run(status, typeof result === "string" ? result : JSON.stringify(result || {}), now, id);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export function getSummaryStats() {
  const db = getDb();
  const totalLogs = db.prepare("SELECT COUNT(*) AS c FROM logs").get().c;
  const totalErrors = db.prepare("SELECT COUNT(*) AS c FROM logs WHERE level IN ('error', 'fatal')").get().c;
  const hasSketch = fs.existsSync(getSketchJsonPath());
  const github = readGitHubContext();

  return {
    totalLogs,
    totalErrors,
    hasSketch,
    dbPath: getDbPath(),
    githubReposCount: github?.repos?.length || (Array.isArray(github) ? github.length : 0),
  };
}

// ---------------------------------------------------------------------------
// X-ray selections ("send to agent" from X-ray mode)
// ---------------------------------------------------------------------------
const xrayDir = () => path.join(getStoreDir(), "xray");

/** Saves the newest selection (replacing the previous one); crops go to files, details to latest.json. */
export function writeXray(payload) {
  const dir = xrayDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const elements = (payload.elements || []).map((el, i) => {
    const { screenshot, ...rest } = el;
    const m = /^data:image\/png;base64,(.+)$/s.exec(screenshot || "");
    if (!m) return rest;
    const file = `element-${i + 1}.png`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(m[1], "base64"));
    return { ...rest, screenshot_file: file };
  });
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ ...payload, elements }, null, 2));
  return elements.length;
}

/** The newest selection with its crops as base64 images, or null. */
export function readXray() {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(xrayDir(), "latest.json"), "utf8"));
    const images = doc.elements.map((el) => {
      if (!el.screenshot_file) return null;
      try { return fs.readFileSync(path.join(xrayDir(), path.basename(el.screenshot_file))).toString("base64"); } catch { return null; }
    });
    return { doc, images };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Video reviews: a screen recording plus the moments the user paused on
// ---------------------------------------------------------------------------
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const videoRoot = () => path.join(getStoreDir(), "video");
const safeId = (id) => String(id || "").replace(/[^\w.-]/g, "_").slice(0, 64);
export const videoDir = (id) => path.join(videoRoot(), safeId(id));
export const videoPath = (id) => path.join(videoDir(id), "video.webm");

/** Opens the file the video upload streams into. Returns { stream, cap } (cap = byte limit). */
export function openVideoWrite(id) {
  fs.mkdirSync(videoDir(id), { recursive: true });
  return { stream: fs.createWriteStream(videoPath(id)), cap: MAX_VIDEO_BYTES };
}

/**
 * Saves the review (moments with their frames and notes) next to the video.
 * Frames go to files; review.json keeps only their names.
 */
export function writeVideoReview(review) {
  const id = safeId(review.id);
  const dir = videoDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const moments = (review.moments || []).map((m, i) => {
    const { frame, ...rest } = m;
    const parsed = /^data:image\/jpeg;base64,(.+)$/s.exec(frame || "");
    if (!parsed) return rest;
    const file = `moment-${i + 1}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(parsed[1], "base64"));
    return { ...rest, frame_file: file };
  });
  const doc = { ...review, id, moments, video_file: fs.existsSync(videoPath(id)) ? videoPath(id) : null, savedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "review.json"), JSON.stringify(doc, null, 2));
  fs.writeFileSync(path.join(videoRoot(), "latest.txt"), id);
  return doc;
}

/** The newest review (or the one asked for) with its frames as base64, or null. */
export function readVideoReview(id) {
  try {
    const wanted = safeId(id) || fs.readFileSync(path.join(videoRoot(), "latest.txt"), "utf8").trim();
    const doc = JSON.parse(fs.readFileSync(path.join(videoDir(wanted), "review.json"), "utf8"));
    const frames = doc.moments.map((m) => {
      try { return fs.readFileSync(path.join(videoDir(wanted), path.basename(m.frame_file))).toString("base64"); } catch { return null; }
    });
    return { doc, frames };
  } catch { return null; }
}
