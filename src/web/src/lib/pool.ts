/**
 * Runs `task` over `items` with at most `limit` in flight; resolves when all
 * settle.
 *
 * CONTRACT: `task` must not throw — it is fire-and-report (it records its own
 * outcome via side effects). A throwing task rejects the underlying
 * `Promise.all` and abandons the other in-flight workers, so callers own all
 * error handling inside `task`.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      await task(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}
