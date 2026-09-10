/**
 * One server-sent-events response, fed by a subscription.
 *
 * A `ReadableStream` rather than a loop that polls a queue: the bus already
 * pushes, so a loop would only add a wake-up interval and a way for an event to
 * sit in a buffer waiting for it. `cancel` is the browser going away, which is
 * the only unsubscribe signal an `EventSource` gives us, and dropping the
 * listener there is what stops a long-lived process accumulating one
 * subscriber per page anybody ever opened.
 */

/** How often a comment goes out to keep an idle connection off a proxy's timeout. */
const HEARTBEAT_MS = 25_000

/** How long a browser waits before reconnecting after the stream drops. */
const RETRY_MS = 3_000

export interface SseStreamOptions {
  /** The event name every message is sent under, matching the contract. */
  eventName: string
  /**
   * Attaches the emitter and returns the unsubscribe. Called once, when the
   * stream starts, so nothing published before the browser connected is missed
   * in a way the REST inbox does not already cover.
   */
  subscribe: (emit: (payload: unknown) => void) => () => void
}

export function sseStream(options: SseStreamOptions): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk))
          return true
        } catch {
          // The stream is already closed and `cancel` has not run yet, which
          // happens when a tab is killed mid-write. Tear down here instead of
          // letting the error surface out of a publish that has nothing to do
          // with this reader.
          stop()
          return false
        }
      }
      const stop = (): void => {
        unsubscribe?.()
        unsubscribe = null
        if (heartbeat !== null) clearInterval(heartbeat)
        heartbeat = null
      }

      write(`retry: ${RETRY_MS}\n\n`)
      unsubscribe = options.subscribe((payload) => {
        write(`event: ${options.eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
      })
      heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS)
    },
    cancel() {
      unsubscribe?.()
      unsubscribe = null
      if (heartbeat !== null) clearInterval(heartbeat)
      heartbeat = null
    },
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
