/**
 * json-path.js — read a value out of parsed JSON with a simple path.
 *
 *   data.items[0].id      $.user.name      items[-1]      ["odd key"].x
 *
 * Deliberately small (no filters or wildcards): enough for assertions and for
 * pulling a token out of a login response.
 */

/** Splits "a.b[0]['c d']" into ["a","b",0,"c d"]. Returns null when the path is malformed. */
export function parsePath(path) {
  let p = String(path ?? "").trim();
  if (p.startsWith("$")) p = p.slice(1);
  if (p.startsWith(".")) p = p.slice(1);
  if (!p) return [];
  const parts = [];
  const re = /([^.[\]]+)|\[(-?\d+)\]|\[\s*(?:"([^"]*)"|'([^']*)')\s*\]/g;
  let consumed = 0, m;
  while ((m = re.exec(p))) {
    if (m.index > consumed && !/^[.\s]*$/.test(p.slice(consumed, m.index))) return null;
    consumed = re.lastIndex;
    if (m[1] !== undefined) parts.push(m[1]);
    else if (m[2] !== undefined) parts.push(Number(m[2]));
    else parts.push(m[3] ?? m[4]);
  }
  return /^[.\s]*$/.test(p.slice(consumed)) ? parts : null;
}

/** The value at `path`, or `undefined` when any step is missing. Negative indexes count from the end. */
export function getPath(data, path) {
  const parts = parsePath(path);
  if (parts === null) return undefined;
  let cur = data;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof part === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[part < 0 ? cur.length + part : part];
    } else cur = cur[part];
  }
  return cur;
}
