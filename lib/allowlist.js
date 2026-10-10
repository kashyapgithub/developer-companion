/**
 * allowlist.js — which sites this extension is allowed to attach to, and
 * what to call each one.
 */

const STORAGE_KEY = "allowlist";

const DEFAULT_ALLOWLIST = [
  { domain: "localhost", label: "localhost" },
  { domain: "127.0.0.1", label: "127.0.0.1" }
];

function normalizeEntry(entry) {
  if (typeof entry === "string") {
    const domain = entry.trim().toLowerCase();
    return { domain, label: domain };
  }
  const domain = (entry?.domain || "").trim().toLowerCase();
  const label = (entry?.label || domain).trim();
  return { domain, label };
}

/** @returns {Promise<{domain: string, label: string}[]>} */
export async function getAllowlist() {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get({ [STORAGE_KEY]: null });
  if (raw === null || raw === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_ALLOWLIST });
    return DEFAULT_ALLOWLIST;
  }
  return raw.map(normalizeEntry).filter((e) => e.domain);
}

/** @param {Array<string|{domain: string, label?: string}>} entries */
export async function setAllowlist(entries) {
  const seenDomains = new Set();
  const normalized = [];
  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    if (entry.domain && !seenDomains.has(entry.domain)) {
      seenDomains.add(entry.domain);
      normalized.push(entry);
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

function matchesEntry(entry, url) {
  if (entry.domain.includes(":")) {
    return url.host === entry.domain;
  }
  return url.hostname === entry.domain || url.hostname.endsWith(`.${entry.domain}`);
}

export async function getAppNameForUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const allowlist = await getAllowlist();
  const match = allowlist.find((entry) => matchesEntry(entry, url));
  return match ? match.label : null;
}

export async function isAllowed(urlString) {
  return (await getAppNameForUrl(urlString)) !== null;
}
