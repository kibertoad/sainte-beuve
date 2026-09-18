/**
 * A bounded fan-out: run over a list with at most N in flight.
 *
 * `Promise.all` over a mapped list and a `for await` loop are the two things
 * this is not. The loop is what the reminder tick used to be — every store
 * round trip and every outbound post waiting on the one before it, which on D1
 * is a network hop per statement and on a Worker is the invocation's budget
 * spent on latency. `Promise.all` is the other failure: a tenancy with fifty due
 * nudges would open fifty Slack posts at once and meet a rate limit instead of a
 * queue.
 *
 * So: a small pool, the order of the ANSWERS preserved (the caller counts them
 * and reports per org), and nothing clever. A worker takes the next index until
 * the list is spent, which means a slow item holds up only its own worker.
 *
 * It does NOT swallow failures. Every caller here already decides what a failure
 * to one item means — the tick records it on the row it belongs to — and a
 * helper that turned a rejection into a result would move that decision
 * somewhere nobody is looking.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index]
      // `noUncheckedIndexedAccess` types the read as possibly undefined; the
      // bound above is what makes it not, and a guard is cheaper than a cast.
      if (item === undefined) continue
      results[index] = await run(item)
    }
  }
  // No more workers than there is work: an idle org's pass should cost nothing.
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
