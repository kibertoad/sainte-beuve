import type { AttentionEvent } from '@sainte-beuve/contracts'
import { attentionEventSchema } from '@sainte-beuve/contracts'
import * as v from 'valibot'

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
 * THROUGH THE CONTRACT'S OWN SCHEMA, which is the only check that is worth
 * making here. A hand-written shape test is the bug it is trying to prevent: it
 * reads `typeof request === 'object'`, which `null` passes, and it says nothing
 * about the fields the subscriber actually reaches — `reaches` walks
 * `request.commitments`, and a row without one throws a `TypeError` out of a
 * websocket message handler that nothing on this runtime catches.
 *
 * Defensive even though the only writer is the publish path above, because the
 * realistic case is a rollout: two builds of one deployment share an org's hub
 * for as long as it takes to replace them. A frame carrying FIELDS this build
 * does not know is read fine — the schema ignores what it does not name — and
 * only one missing something the contract requires is dropped, which costs an
 * event where throwing costs the connection.
 */
export function decodeEvent(frame: string | ArrayBuffer): AttentionEvent | null {
  if (typeof frame !== 'string') return null
  const read = v.safeParse(attentionEventSchema, parseJson(frame))
  return read.success ? read.output : null
}

function parseJson(frame: string): unknown {
  try {
    return JSON.parse(frame)
  } catch {
    return null
  }
}
