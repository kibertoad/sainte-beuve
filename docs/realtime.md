# The attention stream

An attention request is a person asking the team to look at something, addressed
by skill rather than by name. It reaches people two ways, and only one of them is
live.

## Two paths, and which one is load-bearing

`GET /api/v1/attention` is the inbox. It reads the store, filters on the same
audience rule the stream filters on, and is what a page opened an hour after the
ask was raised shows. It is correct on every runtime and in every deployment
shape, and it is the path the feature is built on.

`GET /api/v1/attention/stream` is server-sent events over the same payload. It is
what makes a page that is ALREADY open react within a second. It is an
optimisation, and it is allowed to be one: the SPA fetches the inbox after it
attaches and refetches on every reconnect, so a stream that drops costs latency
rather than correctness.

That order is why the fan-out below can be best effort. A publish happens after a
write that has already landed; it must never be able to fail that write, and a
deployment that cannot reach its fan-out still serves an inbox that is right.

## The port

`AttentionBus` (in `@sainte-beuve/kernel`) is two methods, `publish` and
`subscribe`, and every one of them names an org.

The org is in the SIGNATURE rather than bound into the object because the bus is
the one thing on the container that `withOrg` cannot hand out a scoped copy of:
it has to be one object per process on a runtime that rebuilds its container per
request. `scopedBus` closes that from the other side — `AppContainer.bus` is a
`ScopedAttentionBus` already bound to one tenancy, so no service anywhere passes
an org and none can reach another's streams. Without it the leak is quiet and
total: the audience rule a subscriber filters on knows about skills and teams and
nothing about orgs, so an ask with no required skills concerns any available
reviewer, in any tenancy.

`subscribe` also takes an optional `onClose`, which is the bus reporting a
subscription NOBODY unsubscribed. An in-process implementation never calls it.
One that reaches across a network has to, because the alternative is a response
left open that reports itself live and delivers nothing.

Closing a stream is how the reader is told, so it is also how a deployment whose
hub is unreachable answers every request: the stream opens, the subscribe fails,
the response ends, and the page comes back. Both ends bound what that costs. The
response names a much longer `retry` when it ends on `onClose` than when a reader
merely went away, and the SPA owns the reconnect rather than leaving it to
`EventSource`'s fixed interval — repeated failures back off to a minute, and a
stream that lasted starts the next one back at the floor.

## Two implementations

| Implementation              | Reaches                        | Wired by                        |
| --------------------------- | ------------------------------ | ------------------------------- |
| `InMemoryAttentionBus`      | the subscribers of one process | Node, local, an unbound Worker  |
| `DurableObjectAttentionBus` | every isolate of one Worker    | a Worker with `ATTENTION` bound |

`/health` reports which, as `realtime: "memory" | "durable-object"`, beside the
store and for the same reason: every deployment has one, and what an operator
needs to know is WHICH. `memory` is the whole of a Node deployment — one process,
so every open page is on it — and on a Worker it means an event reaches the
isolate it was published on and no other.

### The hub

`AttentionHub` is a Durable Object, one per org, holding every attention stream
that org has open wherever the isolate serving it happens to be. An isolate
attaches a stream by opening a WebSocket to it and publishes by POSTing one
event; the hub sends that frame to every socket it holds.

**The tenancy is the object's identity.** `idFromName(orgId)` is the whole of the
boundary: an event published in one org reaches a different object from the one
another org's streams are attached to, so there is no filter to get wrong and no
list to walk past the end of.

**It stores nothing.** Every byte it holds is a socket somebody has a page open
on, which is why the sockets are accepted for hibernation — the runtime holds
them while the object is evicted, and a publish wakes it with the connections
still there. An attention event is worth a fan-out and is not worth a write: the
row it describes is already in the store the inbox reads, and a hub that replayed
history would be a second, worse copy of it.

**The bus is built per request**, which is the opposite of the in-memory one and
for the inverse reason. The in-memory bus has to outlive the container because
its state IS the subscriber list; this one holds no state, and it does need two
things that belong to a request: the runtime's `waitUntil` (a publish must not be
awaited, and a Worker cancels unawaited I/O when the response is returned) and an
I/O context a socket can be opened in — workerd refuses a socket used from a
different request than the one that opened it.

**The loopback is not optimised away.** A publish does not also fan out to the
subscribers of the isolate it was made on; those go through the hub like
everybody else's. Delivering locally as well would need every frame to carry the
id of the isolate that sent it so a subscriber could drop its own echo — a
de-duplication rule paid on every event, to save a round trip on the fraction of
them whose reader happens to be here.

### What is still true of both

- **A subscription can miss what was published before it attached.** The socket
  opens asynchronously where `subscribe` answers at once. The SPA closes that
  window the way it closes the reconnect one: it fetches the inbox after
  attaching.
- **Ordering between two publishes is not guaranteed** once the fan-out is a
  network hop. On the Worker each publish is its own unawaited fetch to the hub,
  so the `resolved` that followed a `committed` can arrive before it.

  That is not a snapshot that goes stale until the next event, because for the
  request it is about there IS no next event and no next fetch: each event
  carries the whole row, so the older one wins by landing second, and a request
  the server has closed is not in the inbox to be corrected by a refetch. It is
  the one failure this feature cannot have — an answered ask back on everybody's
  board.

  So the reader orders them. Every row carries `updatedAt`, the store's own stamp
  on the write the event announces, and the SPA keeps the newest stamp it has
  applied per request id and drops anything older — including a row the REST
  inbox hands it, which is the same race seen from the other side. See
  `createAttentionLedger`. The ledger remembers requests that have LEFT the list,
  because a resolved ask is exactly the one a late event would resurrect.

## Configuring it

On the Worker, bind the hub and declare the class:

```toml
[[durable_objects.bindings]]
name = "ATTENTION"
class_name = "AttentionHub"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AttentionHub"]
```

There is no id to paste and nothing to create first: `wrangler deploy` makes the
namespace, and an org's hub comes into being the first time somebody in it opens
the workspace. The deployment re-exports the class beside `default` (see
`deploy/backend/src/index.ts`), because wrangler looks it up as a named export of
the entry point.

Leave the binding out and the Worker still boots, on the in-isolate bus, and says
so on `/health`.

The Node service needs nothing: one process is one bus. The day it is run behind
a load balancer it has the Worker's problem, and `realtime: "memory"` on
`/health` is where that will show.
