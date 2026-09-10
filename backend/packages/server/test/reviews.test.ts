import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  PR,
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  openReview,
  patch,
  post,
} from './helpers.js'

/** The header the CORS cases are all about. */
const ALLOW_ORIGIN = 'access-control-allow-origin'

describe('review board API', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness()
  })

  it('reports which capabilities the deployment wired', async () => {
    const res = await harness.app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    // The outbound flags and the inbound ones are separate: posting to Slack
    // needs a bot token and trusting a slash command needs the signing secret,
    // so a deployment with one and not the other is half wired and has to look
    // like it.
    expect(await res.json()).toStrictEqual({
      status: 'ok',
      // The harness runs on the in-memory store, which is what a deployment
      // that wired no database gets and what the probe has to say out loud.
      persistence: 'memory',
      // Answered by READING the store, not by naming it: see the degraded case
      // below for what the name alone cannot tell an operator.
      persistenceReady: true,
      capabilities: {
        chat: false,
        vcs: { github: false, gitlab: false },
        aiReview: false,
        secrets: false,
        githubWebhooks: false,
        slackInteractivity: false,
      },
    })
  })

  it('refuses the probe when the store it named does not answer', async () => {
    // The deployment this is about: a database created and its migrations
    // skipped. The binding resolves, so the container reports `postgres`, and
    // every board route answers `no such table`. A probe that read the name off
    // the container would call that healthy.
    const unreachable = buildHarness({
      persistence: 'postgres',
      repositories: {
        ...buildHarness().container.repositories,
        integrationTokens: {
          list: () => Promise.reject(new Error('relation "integration_tokens" does not exist')),
          get: () => Promise.reject(new Error('unreachable')),
          put: () => Promise.reject(new Error('unreachable')),
          delete: () => Promise.reject(new Error('unreachable')),
        },
      },
    })
    const res = await unreachable.app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      status: 'degraded',
      persistence: 'postgres',
      persistenceReady: false,
    })
  })

  it('opens a review request and lists it', async () => {
    const review = await openReview(harness)
    expect(review.status).toBe('open')

    const listed = await harness.app.fetch(new Request('http://localhost/api/v1/reviews'))
    const body = (await listed.json()) as { reviews: { id: string }[] }
    expect(body.reviews.map((r) => r.id)).toStrictEqual([review.id])
  })

  it('refuses to track the same pull request twice', async () => {
    await openReview(harness)
    const res = await harness.app.fetch(
      post('/api/v1/reviews', { pullRequest: PR, title: 'Again', authorLogin: 'author' }),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'conflict' } })
  })

  it('rejects a payload the contract does not accept', async () => {
    const res = await harness.app.fetch(post('/api/v1/reviews', { title: 'no pull request' }))
    expect(res.status).toBe(400)
  })

  it('assigns a reviewer with the required skill and never the author', async () => {
    const author = await addReviewer(harness, {
      displayName: 'Author',
      handles: { github: 'author' },
      skills: ['typescript'],
    })
    const peer = await addReviewer(harness, {
      displayName: 'Peer',
      handles: { github: 'peer' },
      skills: ['typescript'],
    })
    const review = await openReview(harness, { requiredSkills: ['typescript'] })

    const res = await assignReviewer(harness, review.id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      assigned: { reviewerId: string }[]
      review: { status: string }
      shortfallReason: string | null
    }
    expect(body.assigned.map((a) => a.reviewerId)).toStrictEqual([peer.id])
    expect(body.assigned.map((a) => a.reviewerId)).not.toContain(author.id)
    expect(body.review.status).toBe('assigned')
    expect(body.shortfallReason).toBeNull()
  })

  it('says why it could not fill the request instead of assigning the wrong person', async () => {
    await addReviewer(harness, {
      displayName: 'Gopher',
      handles: { github: 'gopher' },
      skills: ['go'],
    })
    const review = await openReview(harness, { requiredSkills: ['rust'] })

    const res = await assignReviewer(harness, review.id)
    const body = (await res.json()) as { assigned: unknown[]; shortfallReason: string }
    expect(body.assigned).toStrictEqual([])
    expect(body.shortfallReason).toBe('no_candidates')
  })

  it('answers 404 for a review that does not exist', async () => {
    const res = await harness.app.fetch(new Request('http://localhost/api/v1/reviews/nope'))
    expect(res.status).toBe(404)
  })

  it('answers 503 naming cat-factory when it is not configured', async () => {
    const review = await openReview(harness)
    const res = await harness.app.fetch(post(`/api/v1/reviews/${review.id}/ai-review`, {}))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable' } })
  })

  it('never assigns the author, whatever case their login is spelled in', async () => {
    const author = await addReviewer(harness, {
      displayName: 'Author',
      handles: { github: 'kibertoad' },
    })
    const review = await openReview(harness, { authorLogin: 'Kibertoad' })

    const body = (await (await assignReviewer(harness, review.id)).json()) as {
      assigned: { reviewerId: string }[]
      shortfallReason: string | null
    }
    expect(body.assigned).toStrictEqual([])
    expect(body.shortfallReason).toBe('no_candidates')
    expect(body.assigned.map((a) => a.reviewerId)).not.toContain(author.id)
  })

  it('releases a reviewer once, however many times the same close is replayed', async () => {
    const reviewer = await addReviewer(harness, {
      displayName: 'Peer',
      handles: { github: 'peer' },
    })
    const review = await openReview(harness)
    await assignReviewer(harness, review.id)
    expect(await outstanding(harness, reviewer.id)).toBe(1)

    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'closed' }))
    expect(await outstanding(harness, reviewer.id)).toBe(0)

    // What a GitHub webhook replay looks like: the same terminal write, twice.
    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'closed' }))
    expect(await outstanding(harness, reviewer.id)).toBe(0)
  })

  it('puts the reviewers back on the hook when a closed review is reopened', async () => {
    const reviewer = await addReviewer(harness, {
      displayName: 'Peer',
      handles: { github: 'peer' },
    })
    const review = await openReview(harness)
    await assignReviewer(harness, review.id)
    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'closed' }))

    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'in_review' }))
    expect(await outstanding(harness, reviewer.id)).toBe(1)
  })

  it('allows the SPA on the wildcard every runtime defaults to', async () => {
    const res = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'http://localhost:3000' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    // A wildcard and credentials are invalid together, so the pair is never sent.
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('does not let the wildcard cover a write', async () => {
    // No route carries a session yet, so `*` on a write would let any page an
    // operator happens to visit empty this deployment's project registry.
    const preflight = (origin: string) =>
      harness.app.fetch(
        new Request('http://localhost/api/v1/projects/p-1', {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'DELETE' },
        }),
      )

    expect((await preflight('https://evil.example.com')).headers.get(ALLOW_ORIGIN)).toBeNull()
    // Loopback still passes: that is the local SPA, which is already code
    // running on the operator's own machine.
    expect((await preflight('http://localhost:3000')).headers.get(ALLOW_ORIGIN)).toBe(
      'http://localhost:3000',
    )
  })

  it('answers only the origins a deployment listed', async () => {
    const listed = buildHarness()
    const app = createApp({
      resolveContainer: () => listed.container,
      corsOrigins: ['https://board.example.com'],
    })

    const allowed = await app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'https://board.example.com' },
      }),
    )
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://board.example.com')

    const refused = await app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'https://evil.example.com' },
      }),
    )
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  })
})

async function outstanding(harness: TestHarness, reviewerId: string): Promise<number> {
  const reviewer = await harness.container.repositories.reviewers.getById(reviewerId)
  return reviewer?.outstandingReviews ?? -1
}
