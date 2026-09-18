import type { AttentionEvent } from '@sainte-beuve/contracts'
import type { AttentionBus, Deferral, Logger } from '@sainte-beuve/kernel'
import { decodeEvent, PUBLISH_URL, SUBSCRIBE_URL } from './protocol.js'

export interface DurableObjectAttentionBusOptions {
  /** The `AttentionHub` namespace a deployment bound. One object per org. */
  namespace: DurableObjectNamespace
  /**
   * The request's own `waitUntil`. A publish must not be awaited — it follows a
   * write that already succeeded — and a Worker cancels unawaited I/O the
   * moment the response is returned, so without this the fan-out is a fetch
   * that is sometimes made and sometimes not.
   */
  waitUntil: Deferral
  logger: Logger
}

/**
 * The attention fan-out for a Worker, through a Durable Object.
 *
 * What it closes: a Worker is many isolates, so the in-process bus reaches the
 * pages that happen to share the isolate a publish landed on. Here a publish is
 * one stub fetch to the org's hub and every stream in the org is attached to
 * that hub, whichever isolate opened it.
 *
 * PER REQUEST, not per isolate, which is the opposite of the in-process bus and
 * for a reason that is exactly the inverse: the in-memory one has to be held at
 * module level because its state IS the subscriber list, and this one holds no
 * state at all — a subscription is a socket of its own and a publish is a fetch
 * of its own. What it does need is the request's `waitUntil`, and a socket
 * opened in one request's I/O context cannot be used from another's, so a bus
 * cached across requests would be the one shape workerd refuses outright.
 *
 * THE LOOPBACK IS NOT OPTIMISED AWAY. A publish does not also fan out to the
 * subscribers of the isolate it was made on: those go through the hub like
 * everybody else's. Delivering locally as well would be faster and would need
 * every frame to carry the id of the isolate that sent it so a subscriber could
 * drop its own echo — a de-duplication rule paid for on every event, to save a
 * round trip on the fraction of them whose reader happens to be here.
 */
export class DurableObjectAttentionBus implements AttentionBus {
  constructor(private readonly options: DurableObjectAttentionBusOptions) {}

  publish(orgId: string, event: AttentionEvent): void {
    const { logger, waitUntil } = this.options
    waitUntil(
      this.hub(orgId)
        .fetch(PUBLISH_URL, { method: 'POST', body: JSON.stringify(event) })
        .then(async (res) => {
          if (!res.ok) throw new Error(`the attention hub answered ${res.status}`)
          logger.debug({ orgId, kind: event.kind, hub: await res.text() }, 'attention fanned out')
        })
        .catch((err: unknown) => {
          // BEST EFFORT, loudly. The write this followed has already landed and
          // the REST inbox will carry the same request to whoever opens the
          // page, so a hub that could not be reached costs the live half and
          // nothing else — but it is a fact about the deployment, so it is a
          // warning rather than a swallow.
          logger.warn({ err, orgId }, 'attention hub publish failed')
        }),
    )
  }

  subscribe(
    orgId: string,
    listener: (event: AttentionEvent) => void,
    onClose?: () => void,
  ): () => void {
    // `subscribe` answers synchronously and opening the socket does not, so the
    // window between the two is one where events are missed. That is the same
    // window the in-process bus has against a page that has not connected yet,
    // and the same thing closes it: the page fetches its inbox after attaching,
    // and refetches on every reconnect.
    let socket: WebSocket | null = null
    let done = false
    const ended = (): void => {
      if (done) return
      done = true
      socket = null
      onClose?.()
    }

    this.open(orgId)
      .then((opened) => {
        if (done) return closeQuietly(opened)
        socket = opened
        listenOn(opened, listener, ended)
      })
      .catch((err: unknown) => {
        this.options.logger.warn({ err, orgId }, 'attention hub subscribe failed')
        ended()
      })

    return () => {
      done = true
      if (socket !== null) closeQuietly(socket)
      socket = null
    }
  }

  private async open(orgId: string): Promise<WebSocket> {
    const res = await this.hub(orgId).fetch(SUBSCRIBE_URL, { headers: { Upgrade: 'websocket' } })
    const socket = res.webSocket
    if (!socket) throw new Error(`the attention hub answered ${res.status} to an upgrade`)
    socket.accept()
    return socket
  }

  /**
   * The org's hub. `idFromName` rather than a stored id, so nothing has to be
   * provisioned before a tenancy's first stream and the boundary needs no
   * lookup: the name IS the org, and a publish cannot address another one.
   */
  private hub(orgId: string): DurableObjectStub {
    return this.options.namespace.get(this.options.namespace.idFromName(orgId))
  }
}

/**
 * Wire an open socket to a listener.
 *
 * `close` and `error` both end the subscription, and both can arrive: the
 * caller's guard is what makes the second one a no-op. Ending rather than
 * reconnecting here is deliberate — the reconnect belongs to the browser, whose
 * `EventSource` retries on its own and refetches the inbox when it does, so a
 * socket rebuilt underneath a stream would be the one path where events are
 * lost with nobody told.
 */
function listenOn(
  socket: WebSocket,
  listener: (event: AttentionEvent) => void,
  ended: () => void,
): void {
  socket.addEventListener('message', (message) => {
    const event = decodeEvent(message.data)
    if (event !== null) listener(event)
  })
  socket.addEventListener('close', ended)
  socket.addEventListener('error', ended)
}

function closeQuietly(socket: WebSocket): void {
  try {
    socket.close(1000, 'the stream was closed')
  } catch {
    // Already closing, which is what a page that went away leaves behind.
  }
}
