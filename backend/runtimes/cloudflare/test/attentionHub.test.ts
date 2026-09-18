import type { AttentionEvent, AttentionRequest } from '@sainte-beuve/contracts'
import type { Logger } from '@sainte-beuve/kernel'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DurableObjectAttentionBus } from '../src/realtime/DurableObjectAttentionBus.js'
import { type HubStatus, STATUS_URL } from '../src/realtime/protocol.js'

// The one thing that can only be proven on the runtime it deploys to, like the
// D1 binding and the Web Crypto adapters beside it: the attention fan-out
// reaching a stream an isolate OTHER than the publisher's opened. The audience
// rule, the inbox and the SSE framing are the server package's, tested there
// against the in-process bus; what is here is the hop between two isolates and
// the tenancy boundary that hop has to respect.
//
// Two `DurableObjectAttentionBus` instances stand in for two isolates, which is
// exactly what they are: the bus is built per request and holds no state, so
// two of them over one namespace differ from two isolates in nothing that
// matters to the hub.

declare global {
  namespace Cloudflare {
    interface Env {
      ATTENTION: DurableObjectNamespace
    }
  }
}

/** How long a case waits for a socket to attach or a frame to arrive. */
const PATIENCE_MS = 1_000

describe('the attention hub', () => {
  it('carries an event to a stream another isolate opened', async () => {
    const { bus: publisher, settled } = busForIsolate()
    const { bus: subscriber } = busForIsolate()
    const received: AttentionEvent[] = []

    const stop = subscriber.subscribe('org-a', (event) => received.push(event))
    await attached('org-a', 1)

    publisher.publish('org-a', eventFor('ask-1'))
    await settled()
    await until(() => received.length === 1)

    // Exactly one copy, which is the other half of the claim: the publishing
    // isolate does not ALSO fan out locally, so nothing arrives twice for a
    // reader that happens to share an isolate with the writer.
    expect(received).toStrictEqual([eventFor('ask-1')])
    stop()
  })

  it('keeps one tenancy out of another, by never addressing the same hub', async () => {
    // The whole of the org boundary here is `idFromName(orgId)`: there is no
    // filter to get wrong, because an event published in one org reaches a
    // different object from the one the other org's streams are attached to.
    // Without it the leak is total — the audience rule a subscriber filters on
    // knows about skills and teams and nothing about orgs, so an ask with no
    // required skills concerns any available reviewer anywhere.
    const { bus: publisher, settled } = busForIsolate()
    const { bus: subscriber } = busForIsolate()
    const received: AttentionEvent[] = []

    const stop = subscriber.subscribe('org-b', (event) => received.push(event))
    await attached('org-b', 1)

    publisher.publish('org-a', eventFor('ask-2'))
    await settled()
    // The event lands in org-a's hub, which is where the proof is: waiting on
    // org-b's stream to stay empty would pass just as well if nothing had been
    // published at all.
    expect(await status('org-a')).toStrictEqual({ subscribers: 0 })
    expect(received).toStrictEqual([])
    stop()
  })

  it('drops the socket when the stream goes away', async () => {
    // A long-lived deployment must not hold one socket per page anybody ever
    // opened, and the hub is the one place that can tell: the isolate that
    // opened it may itself be gone.
    const { bus } = busForIsolate()
    const stop = bus.subscribe('org-c', () => {})
    await attached('org-c', 1)

    stop()
    await attached('org-c', 0)
    expect(await status('org-c')).toStrictEqual({ subscribers: 0 })
  })

  it('reports the subscription it could not make, rather than holding it open', async () => {
    // A bus whose namespace answers nothing: the page must be told, because the
    // browser reconnects on a closed stream and refetches its inbox, where a
    // stream left open would report itself live and deliver nothing for ever.
    const { bus } = busForIsolate(brokenNamespace())
    let closed = false

    bus.subscribe(
      'org-d',
      () => {},
      () => {
        closed = true
      },
    )

    await until(() => closed)
    expect(closed).toBe(true)
  })
})

/**
 * One isolate's bus, plus a way to wait for the publishes it deferred.
 *
 * `settled` is what the runtime's own `waitUntil` does for a request: a publish
 * is never awaited by its caller, so a case that asserted straight after it
 * would be racing the fan-out rather than testing it.
 */
function busForIsolate(namespace: DurableObjectNamespace = env.ATTENTION): {
  bus: DurableObjectAttentionBus
  settled: () => Promise<void>
} {
  const deferred: Promise<unknown>[] = []
  const bus = new DurableObjectAttentionBus({
    namespace,
    waitUntil: (work) => deferred.push(work),
    logger: silentLogger(),
  })
  return {
    bus,
    settled: async () => {
      await Promise.all(deferred)
    },
  }
}

/** A namespace whose objects refuse everything, for the subscribe that fails. */
function brokenNamespace(): DurableObjectNamespace {
  const stub = { fetch: () => Promise.resolve(new Response('no', { status: 500 })) }
  return {
    idFromName: (name: string) => name,
    get: () => stub,
  } as unknown as DurableObjectNamespace
}

function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
}

async function status(orgId: string): Promise<HubStatus> {
  const hub = env.ATTENTION.get(env.ATTENTION.idFromName(orgId))
  return (await (await hub.fetch(STATUS_URL)).json()) as HubStatus
}

/** Wait until the hub is holding this many streams. */
async function attached(orgId: string, count: number): Promise<void> {
  await until(async () => (await status(orgId)).subscribers === count)
}

/**
 * Poll rather than sleep a fixed time: a socket attaching is asynchronous and
 * fast, and a case that waited for the worst of it would cost the suite that
 * wait every run.
 */
async function until(ready: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (Date.now() < deadline) {
    if (await ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the attention hub did not get there within the case deadline')
}

function eventFor(id: string): AttentionEvent {
  return { kind: 'opened', request: requestFor(id) }
}

function requestFor(id: string): AttentionRequest {
  return {
    id,
    pullRequest: {
      provider: 'github',
      owner: 'kibertoad',
      repo: 'sainte-beuve',
      number: 7,
      url: 'https://github.com/kibertoad/sainte-beuve/pull/7',
    },
    title: 'Close the attention stream across isolates',
    requestedById: 'reviewer-1',
    requestedByName: 'kibertoad',
    requiredSkills: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    resolvedAt: null,
  }
}
