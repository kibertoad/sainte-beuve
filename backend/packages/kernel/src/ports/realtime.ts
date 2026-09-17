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
 * EVERY METHOD NAMES AN ORG, and that is not decoration. The bus is one object
 * per PROCESS — it has to be, on a runtime that rebuilds its container per
 * request — so it is the one thing on the container that `forOrg` cannot hand
 * out a scoped copy of. Without the org in the signature, a request raised in
 * one tenancy fans out to every stream in the process, and the audience rule the
 * subscriber filters on knows about skills and teams and nothing about orgs: an
 * ask with no required skills reaches anybody available, in any org.
 *
 * Nothing above this line passes an org, all the same: `AppContainer.bus` is a
 * `ScopedAttentionBus` that `withOrg` binds, exactly as `repositories` is bound.
 *
 * Delivery is BEST EFFORT and synchronous-ish by design: publishing must not be
 * able to fail a write that already happened. A subscriber that throws is
 * dropped, not retried.
 */
export interface AttentionBus {
  publish(orgId: string, event: AttentionEvent): void
  /**
   * Listen to ONE org's events until the returned function is called. Filtering
   * within the org — whether an ask concerns this person — is still the
   * caller's; filtering BETWEEN orgs is not, because a caller that could get it
   * wrong is a caller that will.
   */
  subscribe(orgId: string, listener: (event: AttentionEvent) => void): () => void
}

/**
 * The same bus, already bound to one org: what a service reaches through the
 * container, and the reason no service anywhere passes an org.
 */
export interface ScopedAttentionBus {
  publish(event: AttentionEvent): void
  subscribe(listener: (event: AttentionEvent) => void): () => void
}
