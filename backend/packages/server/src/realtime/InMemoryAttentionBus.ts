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
 */
export class InMemoryAttentionBus implements AttentionBus {
  private readonly listeners = new Set<(event: AttentionEvent) => void>()

  publish(event: AttentionEvent): void {
    // Deleting from a Set mid-iteration is well defined, which is what lets the
    // dead-subscriber cleanup below happen in place.
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A subscriber that throws is a closed stream we have not noticed yet.
        // Dropping it here rather than propagating is deliberate: publishing
        // happens after a write that already succeeded, and letting one dead
        // connection fail that write would turn a browser tab closing into a
        // 500 for the person who raised the request.
        this.listeners.delete(listener)
      }
    }
  }

  subscribe(listener: (event: AttentionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** How many streams are attached. For `/health` and for a test. */
  get subscriberCount(): number {
    return this.listeners.size
  }
}
