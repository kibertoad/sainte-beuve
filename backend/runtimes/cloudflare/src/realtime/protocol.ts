import type { AttentionEvent } from '@sainte-beuve/contracts'

/**
 * The two-verb protocol between a Worker isolate and its attention hub.
 *
 * Its own file because BOTH halves have to agree on it and neither should own
 * it: the hub is a Durable Object that only ever reads these paths, and the bus
 * is a client that only ever writes them. A string spelled twice is the bug
 * that makes a publish answer 404 and lose every event silently.
 */

/**
 * A stub fetch ignores the host — the object is addressed by its id, not by
 * DNS — so this is a placeholder that makes the URL parseable and nothing else.
 * `.invalid` is reserved for exactly that, so a mistake here cannot leave the
 * deployment.
 */
const HUB_ORIGIN = 'https://attention.invalid'

/** Attach a stream. Answers 101 with the isolate's end of the socket. */
export const SUBSCRIBE_PATH = '/subscribe'
export const SUBSCRIBE_URL = `${HUB_ORIGIN}${SUBSCRIBE_PATH}`

/** Fan one event out to every attached stream. Answers how many it reached. */
export const PUBLISH_PATH = '/publish'
export const PUBLISH_URL = `${HUB_ORIGIN}${PUBLISH_PATH}`

/**
 * How many streams the hub is holding. Not part of the fan-out: it is what the
 * suite waits on, and it is the hub's answer to `subscriberCount` on the
 * in-process bus.
 */
export const STATUS_PATH = '/status'
export const STATUS_URL = `${HUB_ORIGIN}${STATUS_PATH}`

/** What `/status` answers. */
export interface HubStatus {
  subscribers: number
}

/**
 * One event off the socket, or null for a frame this build cannot read.
 *
 * Defensive even though the only writer is the publish path above, because the
 * alternative is a `TypeError` thrown from inside a listener the SSE stream
 * cannot catch. A frame from a newer build mid-rollout is the realistic case,
 * and dropping it costs one event where throwing costs the connection.
 */
export function decodeEvent(frame: string | ArrayBuffer): AttentionEvent | null {
  if (typeof frame !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(frame)
    return isEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isEvent(value: unknown): value is AttentionEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AttentionEvent>
  return typeof candidate.kind === 'string' && typeof candidate.request === 'object'
}
