import type { AttentionEvent } from '@sainte-beuve/contracts'
import type { AttentionBus } from '@sainte-beuve/kernel'

/**
 * The in-process implementation of the attention bus: what every facade wires
 * today, and the honest ceiling of what an attention stream can reach.
 *
 * It fans out to the subscribers IN THIS PROCESS. On the Node service that is
 * every connected page, which is the whole product; on the Worker it is the
 * subscribers that happen to share an isolate, which is why the REST inbox
 * carries the same payload and is the path the workspace is correct on
 * regardless. A deployment that needs cross-isolate delivery swaps a Durable
 * Object in behind `AttentionBus` and changes nothing above it.
 *
 * ONE per process, not one per request. On a runtime that builds its container
 * per invocation (the Worker does: bindings only exist inside one) the bus has
 * to be held at module level, or every subscriber would be listening to a bus
 * nothing ever publishes on.
 *
 * Which is exactly why the ORG is in the signature rather than bound into the
 * object: a process-wide bus is the one thing on the container `forOrg` cannot
 * hand out a scoped copy of, so the listeners are kept in a set PER ORG and a
 * publish never walks another tenancy's. `scopedBus` is what binds it for the
 * services above.
 */
export class InMemoryAttentionBus implements AttentionBus {
  private readonly byOrg = new Map<string, Set<(event: AttentionEvent) => void>>()

  publish(orgId: string, event: AttentionEvent): void {
    const listeners = this.byOrg.get(orgId)
    if (listeners === undefined) return
    // Deleting from a Set mid-iteration is well defined, which is what lets the
    // dead-subscriber cleanup below happen in place.
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // A subscriber that throws is a closed stream we have not noticed yet.
        // Dropping it here rather than propagating is deliberate: publishing
        // happens after a write that already succeeded, and letting one dead
        // connection fail that write would turn a browser tab closing into a
        // 500 for the person who raised the request.
        listeners.delete(listener)
      }
    }
  }

  subscribe(orgId: string, listener: (event: AttentionEvent) => void): () => void {
    const listeners = this.byOrg.get(orgId) ?? new Set()
    listeners.add(listener)
    this.byOrg.set(orgId, listeners)
    return () => {
      listeners.delete(listener)
      // The org's set goes with its last stream, so a process that has served a
      // thousand tenancies does not hold a thousand empty sets for ever.
      if (listeners.size === 0) this.byOrg.delete(orgId)
    }
  }

  /** How many streams are attached, in one org. For `/health` and for a test. */
  subscriberCount(orgId: string): number {
    return this.byOrg.get(orgId)?.size ?? 0
  }
}
