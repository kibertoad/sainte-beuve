import type { AttentionEvent, AttentionRequest } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryAttentionBus } from '../src/realtime/InMemoryAttentionBus.js'
import {
  addReviewer,
  buildHarness,
  del,
  environmentVcs,
  get,
  PR,
  post,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

// Asking for attention, through the app: who the ask reaches, what answering it
// does, and the two ways it is delivered. Who is IN an audience is tested purely
// in @sainte-beuve/reviewers; this suite covers the writes, the refusals and
// the fan-out.

const ATTENTION = '/api/v1/attention'

/** A deployment whose credential acts as `username`, so that is who the viewer is. */
function harnessFor(username: string, bus = new InMemoryAttentionBus()): TestHarness {
  return buildHarness({ vcs: environmentVcs(viewerVcs(username)), bus })
}

async function raise(
  harness: TestHarness,
  overrides: Record<string, unknown> = {},
): Promise<AttentionRequest> {
  const res = await harness.app.fetch(
    post(ATTENTION, { pullRequest: PR, title: 'Add a health check', ...overrides }),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as AttentionRequest
}

async function inbox(harness: TestHarness): Promise<AttentionRequest[]> {
  const res = await harness.app.fetch(get(ATTENTION))
  expect(res.status).toBe(200)
  return ((await res.json()) as { requests: AttentionRequest[] }).requests
}

describe('asking for attention', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = harnessFor('kibertoad')
  })

  it('records who asked, and captures their team at the time', async () => {
    await harness.app.fetch(
      post('/api/v1/reviewers', {
        displayName: 'Igor',
        handles: { github: 'kibertoad' },
        team: 'Platform',
      }),
    )
    const request = await raise(harness, { sameTeamOnly: true })

    expect(request).toMatchObject({
      status: 'open',
      requestedByName: 'Igor',
      team: 'Platform',
      neededCommitments: 1,
      commitments: [],
    })
  })

  it('refuses a critical mass nobody could ever assemble', async () => {
    const res = await harness.app.fetch(
      post(ATTENTION, { pullRequest: PR, title: 'Too many', neededCommitments: 99 }),
    )
    expect(res.status).toBe(400)
  })

  it('shows the requester their own ask, so they can watch it fill up', async () => {
    const request = await raise(harness)
    expect((await inbox(harness)).map((entry) => entry.id)).toStrictEqual([request.id])
  })

  it('addresses an ask to the people who hold the skills it names', async () => {
    const asker = harnessFor('kibertoad')
    await addReviewer(asker, {
      displayName: 'Backender',
      handles: { github: 'backender' },
      skills: ['Backend'],
    })
    await addReviewer(asker, {
      displayName: 'Frontender',
      handles: { github: 'frontender' },
      skills: ['Frontend'],
    })
    await raise(asker, { requiredSkills: ['Backend'] })

    // The audience is derived, so the same store answers differently depending
    // on who is asking for the inbox.
    const backender = buildHarness({
      ...asker.container,
      vcs: environmentVcs(viewerVcs('backender')),
    })
    const frontender = buildHarness({
      ...asker.container,
      vcs: environmentVcs(viewerVcs('frontender')),
    })
    expect(await inbox(backender)).toHaveLength(1)
    expect(await inbox(frontender)).toHaveLength(0)
  })
})

describe('answering an attention request', () => {
  it('resolves the ask once the critical mass has committed', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker, { neededCommitments: 2 })
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })
    const other = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('other')) })

    const first = await peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    expect(((await first.json()) as AttentionRequest).status).toBe('open')

    const second = await other.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    const resolved = (await second.json()) as AttentionRequest
    expect(resolved.status).toBe('resolved')
    expect(resolved.commitments).toHaveLength(2)

    // Resolved means gone from everybody's inbox, including the people who
    // never answered it. An ask that stayed up would train the team to ignore
    // the next one.
    expect(await inbox(asker)).toStrictEqual([])
  })

  it('refuses to let the requester answer their own ask', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker)

    // Their commitment would count towards the critical mass and resolve the
    // ask, withdrawing it from everybody's inbox for a review nobody took.
    const res = await asker.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    expect(res.status).toBe(403)
    expect(await inbox(asker)).toHaveLength(1)
  })

  it('counts a second click from the same person once', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker, { neededCommitments: 2 })
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })

    await peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    const again = await peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))

    expect(((await again.json()) as AttentionRequest).commitments).toHaveLength(1)
  })

  it('refuses to commit to an ask somebody already answered', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker)
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })
    await peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))

    const other = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('other')) })
    const late = await other.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))
    expect(late.status).toBe(409)
  })

  it('puts the pull request on the committer own workspace', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker)
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })
    await peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {}))

    const board = await peer.app.fetch(get('/api/v1/workspace'))
    const committed = ((await board.json()) as { committed: { title: string }[] }).committed
    expect(committed.map((entry) => entry.title)).toStrictEqual(['Add a health check'])
  })

  it('lets only the requester withdraw the ask', async () => {
    const asker = harnessFor('kibertoad')
    const request = await raise(asker)
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })

    expect((await peer.app.fetch(del(`${ATTENTION}/${request.id}`))).status).toBe(403)
    expect((await asker.app.fetch(del(`${ATTENTION}/${request.id}`))).status).toBe(200)
    expect(await inbox(asker)).toStrictEqual([])
  })
})

describe('committing without an ask', () => {
  it('records a promise about a pull request nobody raised', async () => {
    const harness = harnessFor('kibertoad')
    const res = await harness.app.fetch(
      post('/api/v1/commitments', { pullRequest: PR, title: 'Saw it go by' }),
    )
    expect(res.status).toBe(201)

    const board = await harness.app.fetch(get('/api/v1/workspace'))
    expect(((await board.json()) as { committed: unknown[] }).committed).toHaveLength(1)
  })

  it('hands one back and answers with what is left', async () => {
    const harness = harnessFor('kibertoad')
    const created = await harness.app.fetch(
      post('/api/v1/commitments', { pullRequest: PR, title: 'Saw it go by' }),
    )
    const { id } = (await created.json()) as { id: string }

    const res = await harness.app.fetch(del(`/api/v1/commitments/${id}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ commitments: [] })
  })
})

describe('the live stream', () => {
  it('pushes an ask to the people it is addressed to and nobody else', async () => {
    const bus = new InMemoryAttentionBus()
    const asker = harnessFor('kibertoad', bus)
    await addReviewer(asker, {
      displayName: 'Backender',
      handles: { github: 'backender' },
      skills: ['Backend'],
    })
    await addReviewer(asker, {
      displayName: 'Frontender',
      handles: { github: 'frontender' },
      skills: ['Frontend'],
    })
    const backender = buildHarness({
      ...asker.container,
      vcs: environmentVcs(viewerVcs('backender')),
    })
    const frontender = buildHarness({
      ...asker.container,
      vcs: environmentVcs(viewerVcs('frontender')),
    })

    const [wanted, unwanted] = await Promise.all([
      firstEvent(backender),
      firstEvent(frontender, 'nothing'),
      raise(asker, { requiredSkills: ['Backend'] }),
    ])

    expect(wanted?.kind).toBe('opened')
    expect(unwanted).toBeNull()
  })

  it('pushes the resolution, so the ask disappears from a page already open', async () => {
    const bus = new InMemoryAttentionBus()
    const asker = harnessFor('kibertoad', bus)
    const request = await raise(asker)
    const peer = buildHarness({ ...asker.container, vcs: environmentVcs(viewerVcs('peer')) })

    const [event] = await Promise.all([
      firstEvent(asker),
      peer.app.fetch(post(`${ATTENTION}/${request.id}/commit`, {})),
    ])

    expect(event).toMatchObject({ kind: 'resolved', request: { status: 'resolved' } })
  })

  it('drops the subscription when the reader goes away', async () => {
    const bus = new InMemoryAttentionBus()
    const harness = harnessFor('kibertoad', bus)
    const res = await harness.app.fetch(get(`${ATTENTION}/stream`))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(bus.subscriberCount).toBe(1)

    await res.body?.cancel()
    // A long-lived process must not accumulate one listener per page anybody
    // ever opened.
    expect(bus.subscriberCount).toBe(0)
  })
})

/**
 * The first `attention` event on a stream, or null when none arrives before the
 * body is torn down. The body is cancelled either way, so the subscription does
 * not outlive the case.
 */
async function firstEvent(
  harness: TestHarness,
  expecting: 'an event' | 'nothing' = 'an event',
): Promise<AttentionEvent | null> {
  const res = await harness.app.fetch(get(`${ATTENTION}/stream`))
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = expecting === 'an event' ? 20 : 3
  for (let read = 0; read < deadline; read++) {
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
    ])
    if (next === null) break
    if (next.done) break
    buffered += decoder.decode(next.value, { stream: true })
    const payload = /data: (?<json>.*)\n/.exec(buffered)?.groups?.json
    if (payload !== undefined) {
      await reader.cancel()
      return JSON.parse(payload) as AttentionEvent
    }
  }
  await reader.cancel()
  return null
}
