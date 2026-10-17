/**
 * config.js
 * --------------------------------------------------------------------------
 * Server configuration for Developer Companion
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getStoreDir() {
  if (process.env.STORE_DIR) return process.env.STORE_DIR;
  const primary = path.join(os.homedir(), ".developer-companion");
  try {
    fs.mkdirSync(primary, { recursive: true });
    return primary;
  } catch {
    const fallback = path.join(__dirname, ".data");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const STORE_DIR = getStoreDir();
export const CONFIG_PATH = path.join(STORE_DIR, "config.json");

export function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return {
      lan: !!c.lan,
      token: typeof c.token === "string" ? c.token : "",
      port: Number(c.port) || 5959,
      // Cross-OS tester credentials for the get_cross_os_results MCP tool
      githubToken: typeof c.githubToken === "string" ? c.githubToken : "",
      crossOsOwner: typeof c.crossOsOwner === "string" ? c.crossOsOwner : "",
      crossOsRepo: typeof c.crossOsRepo === "string" ? c.crossOsRepo : "",
    };
  } catch {
    return { lan: false, token: "", port: 5959, githubToken: "", crossOsOwner: "", crossOsRepo: "" };
  }
}

export function writeConfig(config) {
  const dir = getStoreDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function newAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export const normalizeCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function codeMatches(presented, stored) {
  const a = Buffer.from(normalizeCode(presented)), b = Buffer.from(normalizeCode(stored));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push({ name, address: i.address });
  }
  return out;
}
