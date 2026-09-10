import type { AttentionEvent } from '@sainte-beuve/contracts'

/**
 * The in-process fan-out behind the attention stream.
 *
 * A PORT rather than an implementation because the honest answer differs per
 * runtime: a Node service is one process and an in-memory bus reaches every
 * connected page, while a Worker is many isolates and one only reaches the
 * subscribers that happen to share it. That is why the REST inbox exists beside
 * the stream and carries the same payload: it is not a fallback for a dropped
 * connection, it is the path that is correct on every runtime, and the stream
 * is the optimisation on top. A deployment that needs cross-isolate delivery
 * swaps in a Durable Object behind this interface and changes nothing above it.
 *
 * Delivery is BEST EFFORT and synchronous-ish by design: publishing must not be
 * able to fail a write that already happened. A subscriber that throws is
 * dropped, not retried.
 */
export interface AttentionBus {
  publish(event: AttentionEvent): void
  /** Listen until the returned function is called. Every event; filtering is the caller's. */
  subscribe(listener: (event: AttentionEvent) => void): () => void
}
