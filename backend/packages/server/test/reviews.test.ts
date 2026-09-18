import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { withAppOrigin } from '../src/http/origins.js'
import {
  PR,
  type TestHarness,
  addReviewer,
  assignReviewer,
  buildHarness,
  get,
  openReview,
  patch,
  post,
} from './helpers.js'

/** The header the CORS cases are all about. */
const ALLOW_ORIGIN = 'access-control-allow-origin'

/** The board as a list of ids, which is what every filter case asserts on. */
async function listedIds(harness: TestHarness, query = ''): Promise<string[]> {
  const res = await harness.app.fetch(new Request(`http://localhost/api/v1/reviews${query}`))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { reviews: { id: string }[] }
  return body.reviews.map((review) => review.id)
}

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
      // Beside the store for the same reason: every deployment has an answer
      // and the one an operator has to be able to read from outside is WHICH.
      auth: { mode: 'open', signInProviders: [], environmentApiKey: false },
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

  it('refuses a status no review can be in', async () => {
    // A filter that silently matched nothing would read as an empty board,
    // which is the one answer somebody working from the wrong vocabulary would
    // not question.
    const res = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews?status=merged'),
    )
    expect(res.status).toBe(400)
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
    expect(body.shortfallReason).toBe('no_skill_match')
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
    expect(body.shortfallReason).toBe('all_excluded')
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
})

/**
 * Which origins this deployment answers, and which of them may change anything.
 *
 * Its own block rather than a tail on the board cases: the rule is about the
 * browser in front of the API rather than about reviews, and both halves of it —
 * what CORS echoes, and what the write guard refuses — have to be read together.
 */
describe('which origins it answers', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness()
  })

  it('answers the local SPA by name, so it can send its session', async () => {
    // Loopback is echoed rather than covered by the wildcard, and the
    // difference is the whole of local development: the credentials header is
    // invalid beside `*`, so a page answered with the wildcard may read the
    // board and may never send its cookie.
    //
    // This harness is addressed on `http://localhost`, which is the other half
    // of the rule: BOTH sides loopback. See the hosted case below.
    const res = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'http://localhost:3000' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('allows any other origin to read on the wildcard every runtime defaults to', async () => {
    const res = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'https://somebody-elses-page.example' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    // A wildcard and credentials are invalid together, so the pair is never
    // sent: an origin this deployment did not name reads, and is nobody.
    //
    // A browser refuses `*` OUTRIGHT on a request that asked to send a
    // credential, and the SPA's client asks on every call — so this is a read
    // for a client that did not, and is why a deployment's own SPA origin is
    // folded in rather than left to the wildcard. See `withAppOrigin`.
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('names the SPA a deployment said it has, so the wildcard default is not a trap', async () => {
    const listed = buildHarness()
    const app = createApp({
      resolveContainer: () => listed.container,
      // What a runtime facade computes: the wildcard it ships, plus the origin
      // of the APP_BASE_URL the deployment already had to set.
      corsOrigins: withAppOrigin(['*'], 'https://board.example.com/'),
    })

    const res = await app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'https://board.example.com' },
      }),
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('https://board.example.com')
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('refuses a cross-site write even where no preflight would have run', async () => {
    // A `text/plain` POST from another page is a SIMPLE request: there is no
    // preflight to refuse, the browser sends the session cookie, and CORS
    // withholds only the answer — by which time the write has happened.
    const simplePost = (origin: string | null) =>
      harness.app.fetch(
        new Request('http://localhost/api/v1/projects', {
          method: 'POST',
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            ...(origin === null ? {} : { origin }),
          },
          body: JSON.stringify({ provider: 'github', owner: 'o', repo: 'r' }),
        }),
      )

    const refused = await simplePost('https://evil.example.com')
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('does not accept this request from a page on another')

    // A caller that sets no `Origin` is not a browser: a CI job on an API key,
    // or an inbound webhook, which is authenticated by its own signature.
    expect((await simplePost(null)).status).not.toBe(403)
    // Same origin is the deployment's own SPA, whatever the CORS list says.
    expect((await simplePost('http://localhost')).status).not.toBe(403)
  })

  it('reads the origin a browser addressed rather than the one a proxy handed on', async () => {
    // Behind a TLS terminator the request arrives as `http://` against an
    // internal host, so comparing against the raw URL would have a deployment
    // refusing its own SPA over a scheme it never sees.
    const res = await harness.app.fetch(
      new Request('http://internal-8788/api/v1/projects', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          origin: 'https://board.example.com',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'board.example.com',
        },
        body: '{}',
      }),
    )
    expect(res.status).not.toBe(403)
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

  it("does not hand a hosted deployment to a page on the operator's machine", async () => {
    // The same wildcard, and the deployment is NOT the local one. A page on
    // `http://localhost:<port>` is then some other program on that machine — a
    // dev server, an installed app, a package's postinstall — and echoing it by
    // name would give it the credentials header, and with it the operator's
    // session on every route the Configuration screen uses.
    const hosted = (path: string, headers: Record<string, string>) =>
      harness.app.fetch(new Request(`https://api.example.com${path}`, { headers }))

    const board = await hosted('/api/v1/reviews', { origin: 'http://localhost:3000' })
    // The wildcard it would have given any other unnamed origin, which a
    // browser refuses outright on a request that asked to send a credential.
    expect(board.headers.get(ALLOW_ORIGIN)).toBe('*')
    expect(board.headers.get('access-control-allow-credentials')).toBeNull()

    // And the routes the wildcard never covered are refused outright rather
    // than answered without a CORS header: the read has already happened by
    // then, and this one reads the deployment's credentials.
    const keys = await hosted('/api/v1/settings/api-keys', { origin: 'http://localhost:3000' })
    expect(keys.status).toBe(403)
    expect(keys.headers.get(ALLOW_ORIGIN)).toBeNull()
  })

  it('refuses a cross-site AI-review read, whose GET is not a read', async () => {
    // Answering one polls cat-factory with this deployment's key and writes
    // what it learns onto the run. CORS withholds the answer from a page on
    // another origin; it does not withhold the spend, so the guard has to
    // refuse the request rather than hide it.
    const res = await harness.app.fetch(
      get('/api/v1/ai-review/runs/run-1', { origin: 'https://evil.example.com' }),
    )
    expect(res.status).toBe(403)
    // The deployment's own SPA is not touched by it: same origin, no `Origin`.
    expect((await harness.app.fetch(get('/api/v1/ai-review/runs/run-1'))).status).not.toBe(403)
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

/**
 * What the board IS, as opposed to what the store holds: which rows it answers
 * with, in what order, and with whose names on them. Its own suite because it is
 * its own question — `buildBoard` in @sainte-beuve/reviewers decides all three,
 * and these are the cases that prove the route reads it.
 */
describe('the board read', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness()
  })

  it('caps the board on the newest and answers it most urgent first', async () => {
    const first = await openReview(harness)
    harness.clock.advance(1_000)
    const second = await openReview(harness, {
      pullRequest: { ...PR, number: 8, url: `${PR.url}8` },
    })

    // The two orders are DIFFERENT questions and the route answers both. What
    // the cap keeps is the newest, because a board that dropped the review
    // filed a minute ago would be missing the one somebody is looking for; what
    // the answer is ORDERED by is urgency, and at equal priority that is
    // whatever has waited longest. See `buildBoard` in @sainte-beuve/reviewers.
    expect(await listedIds(harness)).toStrictEqual([first.id, second.id])
    expect(await listedIds(harness, '?limit=1')).toStrictEqual([second.id])

    // Refused rather than clamped: a caller asking for a thousand rows has
    // written something this API will not do, and answering two hundred without
    // saying so reads as a board that lost the rest.
    const tooMany = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews?limit=1000'),
    )
    expect(tooMany.status).toBe(400)
  })

  it('answers the board with the ACTIVE reviews unless asked otherwise', async () => {
    // Terminal reviews are never archived, so an unfiltered read grew with
    // everything the deployment had ever tracked and re-decoded a payload per
    // row nobody looks at. History is still readable — somebody has to ask.
    const review = await openReview(harness)
    await harness.app.fetch(patch(`/api/v1/reviews/${review.id}/status`, { status: 'closed' }))

    expect(await listedIds(harness)).toStrictEqual([])
    expect(await listedIds(harness, '?status=closed')).toStrictEqual([review.id])
    // Both shapes a query string carries a list in: the comma form somebody
    // writing the URL reaches for, and the repeated form the typed client
    // produces. A single repeated value is indistinguishable from a scalar once
    // it is parsed, which is why the contract takes both.
    expect(await listedIds(harness, '?status=open,closed')).toStrictEqual([review.id])
    expect(await listedIds(harness, '?status=open&status=closed')).toStrictEqual([review.id])
  })

  it('names the people on a board row, because an id is not an answer', async () => {
    // The row's whole purpose is "who has this". It carries reviewer IDS, so a
    // board that handed them straight to the screen answered the question with
    // `rvw-3`.
    const peer = await addReviewer(harness, {
      displayName: 'Ada Lovelace',
      handles: { github: 'peer' },
      skills: ['typescript'],
    })
    const review = await openReview(harness, { requiredSkills: ['typescript'] })
    await assignReviewer(harness, review.id)

    const res = await harness.app.fetch(new Request('http://localhost/api/v1/reviews'))
    const body = (await res.json()) as {
      reviews: { assignedReviewers: { reviewerId: string; displayName: string }[] }[]
    }
    expect(body.reviews[0]?.assignedReviewers).toStrictEqual([
      { reviewerId: peer.id, displayName: 'Ada Lovelace' },
    ])
  })
})
