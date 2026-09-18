/**
 * One server-sent-events response, fed by a subscription.
 *
 * A `ReadableStream` rather than a loop that polls a queue: the bus already
 * pushes, so a loop would only add a wake-up interval and a way for an event to
 * sit in a buffer waiting for it. `cancel` is the browser going away, which is
 * the only unsubscribe signal an `EventSource` gives us, and dropping the
 * listener there is what stops a long-lived process accumulating one
 * subscriber per page anybody ever opened.
 *
 * The other direction — the SUBSCRIPTION going away while the browser is still
 * there — is what `end` is for. An in-process bus cannot do that, and a bus
 * that reaches a Durable Object over a socket can: the socket closes when the
 * object is evicted, and a response left open after it would be a stream that
 * reports itself live and delivers nothing for ever. Closing the body instead
 * makes the browser reconnect after `retry`, and the page refetches its inbox
 * on every reconnect, so the gap is closed rather than hidden.
 */

/** How often a comment goes out to keep an idle connection off a proxy's timeout. */
const HEARTBEAT_MS = 25_000

/** How long a browser waits before reconnecting after the READER dropped the stream. */
const RETRY_MS = 3_000

/**
 * How long it waits when the SUBSCRIPTION died instead.
 *
 * The two are different facts and deserve different numbers. A reader that went
 * away and came back is a page being used; a subscription that ended under a
 * reader still holding the response is, on a bus that reaches over a network,
 * most often a fan-out this deployment cannot reach AT ALL — and that does not
 * repair itself in three seconds. `EventSource` reconnects on the interval the
 * last stream gave it and backs off from nothing, and this SPA refetches its
 * inbox every time the stream comes back, so at the reader's interval an
 * unreachable hub costs every open page a stream, a subscribe and an inbox read
 * twenty times a minute for as long as it is down. Saying so on the way out
 * costs one field.
 */
const LOST_RETRY_MS = 30_000

const encoder = new TextEncoder()

export interface SseStreamOptions {
  /** The event name every message is sent under, matching the contract. */
  eventName: string
  /**
   * Attaches the emitter and returns the unsubscribe. Called once, when the
   * stream starts, so nothing published before the browser connected is missed
   * in a way the REST inbox does not already cover.
   *
   * `end` closes the response, for a subscription that has died on its own.
   */
  subscribe: (emit: (payload: unknown) => void, end: () => void) => () => void
}

/** What one open stream is holding: a subscription, and a timer feeding it. */
interface StreamState {
  unsubscribe: (() => void) | null
  heartbeat: ReturnType<typeof setInterval> | null
  /**
   * Set by `detach` before the subscription is even stored, because `end` can
   * fire SYNCHRONOUSLY from inside `subscribe` — a bus that already knows it
   * cannot reach its hub says so at once — and the unsubscribe it returns would
   * then be attached to a stream nothing is going to read.
   */
  detached: boolean
}

export function sseStream(options: SseStreamOptions): Response {
  const state: StreamState = { unsubscribe: null, heartbeat: null, detached: false }
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => attach(state, controller, options),
    cancel: () => detach(state),
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      // Nginx buffers a response body by default, which holds every event until
      // the buffer fills: for a stream that is indistinguishable from a broken
      // feature, and this is the header that turns it off.
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  })
}

function detach(state: StreamState): void {
  state.detached = true
  state.unsubscribe?.()
  state.unsubscribe = null
  if (state.heartbeat !== null) clearInterval(state.heartbeat)
  state.heartbeat = null
}

function attach(
  state: StreamState,
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: SseStreamOptions,
): void {
  const write = (chunk: string): void => {
    try {
      controller.enqueue(encoder.encode(chunk))
    } catch {
      // The stream is already closed and `cancel` has not run yet, which happens
      // when a tab is killed mid-write. Tear down here instead of letting the
      // error surface out of a publish that has nothing to do with this reader.
      detach(state)
    }
  }
  const end = (): void => {
    detach(state)
    // The last thing the reader is told, and the only place this can be said:
    // the response is about to end and the next one is a new request. See
    // `LOST_RETRY_MS`.
    write(`retry: ${LOST_RETRY_MS}\n\n`)
    try {
      controller.close()
    } catch {
      // Already closed, or already errored. The subscription is gone either way,
      // which is the part that had to happen.
    }
  }

  write(`retry: ${RETRY_MS}\n\n`)
  const attached = options.subscribe((payload) => {
    write(`event: ${options.eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
  }, end)
  if (state.detached) {
    attached()
    return
  }
  state.unsubscribe = attached
  state.heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS)
}
