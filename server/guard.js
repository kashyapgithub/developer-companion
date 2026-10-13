/**
 * guard.js
 * --------------------------------------------------------------------------
 * Browser-facing request guards for the local HTTP receiver.
 *
 * Why this exists: the receiver listens on localhost, but ANY web page the
 * user visits can send requests to localhost. Without these checks a random
 * site could read captured logs, read the repo catalog, or queue commands.
 *
 * Two independent defences, both pure functions (easy to unit test):
 *   1. Origin check  — browsers always attach an Origin header to
 *      cross-origin requests. Only extension pages (and explicitly
 *      allowlisted origins) may talk to us. No Origin = curl / MCP / agent
 *      tooling, which is not a browser-driven attack, so it is allowed.
 *   2. Host check    — stops DNS-rebinding, where an attacker domain
 *      resolves to 127.0.0.1 and the page then looks "same-origin".
 * -------------------------------------------------------------------------- */

/** Origin schemes that belong to browser extensions (ours or sibling tools). */
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\//;

/** Host names that always mean "this machine". */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Extra origins the user explicitly trusts, e.g. a hosted viewer.
 * Comma separated in COMPANION_ALLOWED_ORIGINS.
 */
function extraAllowedOrigins() {
  return (process.env.COMPANION_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {boolean} true if a request carrying this Origin may proceed. */
export function isOriginAllowed(origin) {
  if (!origin) return true; // non-browser client (curl, MCP, scripts)
  if (EXTENSION_ORIGIN.test(origin)) return true;
  return extraAllowedOrigins().includes(origin);
}

/** Strips the port from a Host header: "localhost:5959" -> "localhost". */
function hostnameOf(hostHeader = "") {
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLowerCase();
}

/**
 * @param {string} hostHeader raw Host header
 * @param {boolean} lanMode   in LAN mode other hostnames/IPs are expected
 *                            (the access code protects those instead)
 */
export function isHostAllowed(hostHeader, lanMode) {
  if (lanMode) return true;
  return LOCAL_HOSTS.has(hostnameOf(hostHeader));
}

/**
 * Sets CORS headers. Only echoes the caller's own origin when it already
 * passed isOriginAllowed — never a wildcard.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Sketch-Token, X-Access-Token");
}
