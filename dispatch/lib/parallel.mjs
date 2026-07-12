// Helix dispatch — thin parallel-launch substrate (bounded, deterministic output).
//
// Source of truth: the Pi `examples/extensions/subagent` pattern the ROADMAP
// points at: parallel mode runs at most a fixed number of tasks concurrently via
// a bounded worker pool that collects results in INPUT order. This module
// reproduces just that pattern, pure and dependency-free — no subprocesses,
// no network, no ambient effects. Only embarrassingly-parallel candidate launches
// use it; the orchestrator still sequences judge/synthesis/gate/verification.
// The concurrency cap is a resource bound, not cost control (Helix has none).

/**
 * Map `items` through `fn` with at most `concurrency` calls in flight, returning
 * results in the SAME order as `items` regardless of completion order. This is the
 * determinism guarantee: parallel completion order can never change candidate
 * ordering, records, or warnings — the caller processes results in index order.
 *
 * Mirrors Pi's `mapWithConcurrencyLimit`: a fixed pool of `min(concurrency, n)`
 * workers each pull the next index off a shared counter until the list is drained.
 * `fn` must not throw (wrap per-item errors into the result); a throwing `fn`
 * rejects the whole batch, which the orchestrator avoids by catching per candidate.
 *
 * @template TIn, TOut
 * @param {TIn[]} items
 * @param {number} concurrency max in-flight calls (clamped to [1, items.length])
 * @param {(item: TIn, index: number) => Promise<TOut>} fn
 * @returns {Promise<TOut[]>} results in input order
 */
export async function mapWithConcurrency(items, concurrency, fn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = next++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}
