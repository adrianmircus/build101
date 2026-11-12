import "server-only";

/** Runs `work` for every item with at most `limit` at the same time, and keeps the order of the answers. A failure of one is thrown. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const queue = items.entries();
  // The lanes share one iterator: each takes the next item when it is free.
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [index, item] of queue) results[index] = await work(item);
  });
  await Promise.all(lanes);
  return results;
}
