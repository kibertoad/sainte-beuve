---
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
'@sainte-beuve/node-server': patch
---

The attention stream reaches the whole deployment, not one isolate of it.

The live half of the attention inbox fanned out through a bus held at module
level. On the Node service that is every connected page; on the Worker it is the
pages that happen to share the isolate a publish landed on, which is most of them
most of the time and never all of them. The REST inbox always carried the same
payload and is what made the feature correct; this is what makes the live half
live.

- `AttentionHub`, a Durable Object, is the Worker's fan-out: ONE PER ORG, so the
  tenancy is the object's identity rather than a filter somebody could get wrong,
  and an event published in one org reaches a different object from the one
  another org's streams are attached to. It stores nothing — every byte it holds
  is a socket somebody has a page open on, accepted for hibernation so an idle
  hub costs nothing between two events.
- `DurableObjectAttentionBus` implements the existing `AttentionBus`, so nothing
  above the port changed: no service passes an org, no controller knows which
  fan-out it is on. It is built PER REQUEST, unlike the in-memory one, because it
  holds no state and does need the request's own I/O context — workerd refuses a
  socket used from a different request than the one that opened it.
- `RequestScope` carries the runtime's `waitUntil`. A publish follows a write
  that already succeeded, so it must not be awaited, and a Worker cancels
  unawaited I/O when the response is returned: without the deferral the fan-out
  would be a fetch that is sometimes made. A runtime with no execution context
  gets a swallow.
- `AttentionBus.subscribe` takes an optional `onClose`, and the SSE response
  closes on it. A bus that reaches over a socket can lose a subscriber without
  the browser noticing, and a stream left open would report itself live and
  deliver nothing for ever; closing it makes `EventSource` reconnect, which is
  when the SPA refetches its inbox.
- `/health` answers `realtime: "memory" | "durable-object"` beside
  `persistence`, for the same reason: every deployment has a fan-out and what an
  operator needs to know is which. A Worker with no `ATTENTION` binding still
  boots on the in-isolate bus and says so.

A fan-out over a network changes two things above the port, and both are in
here:

- **The reader orders the events.** Two publishes are two independent fetches to
  the hub, so the `resolved` that followed a `committed` can arrive before it —
  and because each event carries the whole row, the older one would win by
  landing second and put an answered ask back on everybody's board, with no next
  event and no next fetch to take it off again. Every row carries `updatedAt`,
  the store's own stamp on the write it announces, and the SPA now drops anything
  older than what it has already applied for that request, from the stream and
  from the inbox alike.
- **A stream that cannot be subscribed backs off.** Ending the response is what
  tells the page to come back, so a deployment whose hub is unreachable answers
  every stream by ending it. The response now names a much longer `retry` when it
  ends on `onClose` than when a reader merely went away, and the SPA owns the
  reconnect instead of leaving it to `EventSource`'s fixed interval: repeated
  failures back off to a minute, and a stream that lasted starts the next one
  back at the floor.

A frame off the hub is read through the contract's own schema rather than a
hand-written shape test, because the audience filter walks `request.commitments`
and a partial row would throw a `TypeError` out of a websocket message handler.
A listener that throws anyway drops its own subscription rather than the
connection every other stream on that isolate shares.

See `docs/realtime.md`.
