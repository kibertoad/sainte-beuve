import { type HubStatus, PUBLISH_PATH, STATUS_PATH, SUBSCRIBE_PATH } from './protocol.js'

/**
 * The attention hub: ONE Durable Object per org, holding every attention stream
 * that org has open, wherever the isolate serving it happens to be.
 *
 * It is the answer to the one thing an in-process bus cannot do on this
 * runtime. A Worker is many isolates, so a bus held at module level fans an
 * event out to the pages that happen to share the isolate the publish landed
 * on and to no others; the REST inbox is what makes the feature correct
 * regardless, and this is what makes the live half live. Nothing above
 * `AttentionBus` knows it exists.
 *
 * THE TENANCY IS THE OBJECT'S IDENTITY. `idFromName(orgId)` is the whole of the
 * boundary here: an event published in one org reaches a different object from
 * the one another org's streams are attached to, so there is no filter to get
 * wrong and no list to walk past the end of. That is a stronger guarantee than
 * the in-process bus's set-per-org, and it is the same rule.
 *
 * It stores NOTHING. Every byte it holds is a socket that a stream is attached
 * to right now, which is why the sockets are accepted for HIBERNATION: the
 * runtime holds them while the object is evicted, and a publish wakes it with
 * the connections still there. An attention event is worth a fan-out and is not
 * worth a write — the row it describes is already in the store the inbox reads,
 * and a hub that replayed history would be a second, worse copy of it.
 */
export class AttentionHub {
  constructor(private readonly ctx: DurableObjectState) {}

  fetch(request: Request): Response | Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === SUBSCRIBE_PATH) return this.attach(request)
    if (pathname === PUBLISH_PATH) return this.broadcast(request)
    if (pathname === STATUS_PATH) return Response.json(this.status())
    return new Response('No such hub route', { status: 404 })
  }

  /** One isolate attaching one stream. */
  private attach(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('The attention hub is reached over a websocket', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    // `acceptWebSocket` rather than `server.accept()`: the runtime holds the
    // connection while this object is evicted, so a hub with a hundred idle
    // streams costs nothing between two events. The isolate never sends
    // anything back, so there is no message handler to write.
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * One event to every stream, and a count back.
   *
   * The count is the publisher's only feedback and it is deliberately not an
   * error condition: zero means nobody in this org had a page open, which is
   * the ordinary case and not a failure. What the caller does with it is log,
   * at debug.
   */
  private async broadcast(request: Request): Promise<Response> {
    const frame = await request.text()
    let delivered = 0
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(frame)
        delivered++
      } catch {
        // A socket whose far end has gone without the close landing here. Drop
        // it rather than letting one dead page fail the fan-out for everybody
        // else in the org: the publish already happened, and the write it
        // followed already succeeded.
        close(socket)
      }
    }
    return Response.json({ delivered })
  }

  private status(): HubStatus {
    return { subscribers: this.ctx.getWebSockets().length }
  }
}

function close(socket: WebSocket): void {
  try {
    socket.close(1011, 'the attention hub could not reach this stream')
  } catch {
    // Already closing. Nothing to do and nothing to report.
  }
}
