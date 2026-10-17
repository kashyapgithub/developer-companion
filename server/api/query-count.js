/**
 * query-count.js — reads the query counts the optional `probe/` helper adds to responses
 * (x-dc-queries, x-dc-query-ms) and spots the N+1 shape.
 */

/** { count, ms } from response headers, or undefined when the backend doesn't report. */
export function readQueries(headers = {}) {
  const count = Number(headers["x-dc-queries"]);
  if (!Number.isFinite(count) || headers["x-dc-queries"] === undefined) return undefined;
  const ms = Number(headers["x-dc-query-ms"]);
  return { count, ...(Number.isFinite(ms) ? { ms } : {}) };
}

/** The biggest array in a JSON response (root, or one level down: data/items/results…). */
function listLength(json) {
  if (Array.isArray(json)) return json.length;
  if (json && typeof json === "object") return Math.max(0, ...Object.values(json).filter(Array.isArray).map((a) => a.length));
  return 0;
}

/** A plain-language warning, or undefined when the count looks fine. */
export function queryAdvice(queries, json) {
  if (!queries) return undefined;
  const items = listLength(json);
  if (items >= 3 && queries.count >= items + 1) return `${queries.count} queries for ${items} items: this looks like an N+1 (one query for the list, then one per item). Load the related rows in one query (JOIN, IN (...), or your ORM's include/eager loading).`;
  if (queries.count > 25) return `${queries.count} queries for one request is a lot. Check for queries inside loops.`;
  return undefined;
}
