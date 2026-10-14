/**
 * agent-guard.js — which URLs the AGENT may call through the API client.
 *
 * You (in the popup) can call anything. The agent is more restricted, because an agent
 * that can be steered by text it reads could otherwise be talked into probing your network
 * or leaking data to a stranger's server. It may call:
 *   - localhost / 127.0.0.1 / [::1];
 *   - hosts you set up yourself: any host that appears in a URL-looking variable of an
 *     environment or collection (e.g. baseUrl = https://staging.myapp.com).
 * Anything else is refused with a message saying how to allow it.
 */

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** hostname of a URL-like string, or null. */
function hostOf(value) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname.toLowerCase(); } catch { return null; }
}

/** Hosts the user has configured via variables that look like URLs (http…). */
export function configuredHosts(state) {
  const hosts = new Set();
  const scan = (vars) => { for (const v of Object.values(vars || {})) if (/^https?:\/\//i.test(String(v))) { const h = hostOf(String(v)); if (h) hosts.add(h); } };
  for (const e of state.environments || []) scan(e.variables);
  for (const c of state.collections || []) scan(c.variables);
  return hosts;
}

/** @returns {(url:string)=>string|null} refuses with a message, or returns null to allow */
export function makeAgentGuard(state) {
  const allowed = configuredHosts(state);
  return (url) => {
    const host = hostOf(url);
    if (!host) return "That isn't a valid URL.";
    if (LOCAL.has(host) || allowed.has(host)) return null;
    return `The agent may only call localhost and hosts you've set up. "${host}" isn't one of them. To allow it, add an environment variable such as baseUrl = https://${host} in the API window.`;
  };
}
