// overlay/modules/concurrency.js
//
// One job: run an async function over a list of items without
// launching all of them at once. Used to throttle AI description
// requests — firing one request per repo simultaneously would blow
// through a free-tier rate limit (e.g. Gemini's free tier) almost
// immediately once you have more than a handful of repos.

/**
 * Runs `worker(item, index)` for every item in `items`, keeping at
 * most `limit` calls in flight at a time. Resolves once every item
 * has been processed (errors inside `worker` should be caught by the
 * caller — this function doesn't swallow them).
 */
export async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;

  async function runNextItem() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;

    await worker(items[index], index);
    await runNextItem();
  }

  const laneCount = Math.min(limit, items.length);
  const lanes = Array.from({ length: laneCount }, () => runNextItem());
  await Promise.all(lanes);
}
