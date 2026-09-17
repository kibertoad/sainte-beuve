import type { AuthState, Org, Reviewer } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import type { VcsIdentityGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { withOrg } from '../src/container.js'
import { InMemoryAttentionBus } from '../src/realtime/InMemoryAttentionBus.js'
import { runReminderTick } from '../src/reminders/tick.js'
import {
  buildHarness,
  cookieJar,
  everyHost,
  get,
  post,
  stubGateways,
  type TestHarness,
} from './helpers.js'

/**
 * The org boundary, through `app.fetch`.
 *
 * The stores prove that two tenancies cannot read each other
 * (`@sainte-beuve/persistence-conformance`). What is left for this suite is
 * everything ABOVE them, which is where the boundary is actually decided: that a
 * cookie carries its org, that the container is rebound from it before any
 * handler runs, that a member is refused the routes an admin holds, and that the
 * first person into an org is its admin.
 *
 * `required` throughout, because `open` deliberately refuses nobody: an
 * anonymous caller there is an admin of the default org by design (see `roleOf`),
 * and a suite that ran in that mode would assert the absence of the thing it is
 * about.
 */

const KEY = btoa('0123456789abcdef0123456789abcdef')
const SESSION = '/api/v1/auth/session'
const ORGS = '/api/v1/settings/orgs'
const REVIEWERS = '/api/v1/reviewers'
const BOOTSTRAP = 'the-operators-key'

function stubSignIn(username: string, subject: string): VcsIdentityGateway {
  return {
    authorizeUrl: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeCode: async ({ code }) => ({
      token: `gho_${code}_token`,
      account: { subject, username, displayName: username, avatarUrl: null },
    }),
  }
}

/** A `required` deployment with an OAuth client, a signing key and the bootstrap key. */
function closedHarness(account = { username: 'ada', subject: '1' }): TestHarness {
  return buildHarness(
    {
      gateways: stubGateways({ signIn: everyHost(stubSignIn(account.username, account.subject)) }),
      auth: {
        mode: 'required',
        environmentApiKey: BOOTSTRAP,
        sessionLifetimeMs: 30 * 24 * 60 * 60 * 1000,
      },
    },
    { encryptionKey: KEY },
  )
}

function asBootstrap(): Record<string, string> {
  return { authorization: `Bearer ${BOOTSTRAP}` }
}

/**
 * Walk a sign-in and hand back the cookie the callback set, optionally naming an
 * org. The cookie is the whole of what a browser keeps, so presenting it on the
 * next request is exactly what a browser does.
 */
async function signIn(harness: TestHarness, org?: string): Promise<string> {
  const jar = cookieJar()
  const path =
    org === undefined ? '/api/v1/auth/sign-in/github' : `/api/v1/auth/sign-in/github?org=${org}`
  const start = await harness.app.fetch(get(path))
  expect(start.status).toBe(200)
  jar.keep(start)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
  const callback = await harness.app.fetch(
    get(
      `/connect/github/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
      jar.headers(),
    ),
  )
  expect(callback.headers.get('set-cookie')).toContain('sb_session=')
  jar.keep(callback)
  return jar.headers().cookie ?? ''
}

async function authState(harness: TestHarness, cookie: string): Promise<AuthState> {
  const res = await harness.app.fetch(get(SESSION, { cookie }))
  expect(res.status).toBe(200)
  return (await res.json()) as AuthState
}

async function makeOrg(harness: TestHarness, slug: string, name = slug): Promise<Org> {
  const res = await harness.app.fetch(post(ORGS, { slug, name }, asBootstrap()))
  expect(res.status).toBe(201)
  return (await res.json()) as Org
}

async function reviewersOn(harness: TestHarness, cookie: string): Promise<string[]> {
  const res = await harness.app.fetch(get(REVIEWERS, { cookie }))
  expect(res.status).toBe(200)
  const { reviewers } = (await res.json()) as { reviewers: Reviewer[] }
  return reviewers.map((reviewer) => reviewer.displayName)
}

describe('the org boundary', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = closedHarness()
  })

  describe('where a caller lands', () => {
    it('puts a caller this deployment cannot place in the default org', async () => {
      // The bootstrap key is an environment variable rather than a row, so there
      // is nothing to read a tenancy off. The default org is the answer, which
      // is what keeps a single-tenant deployment behaving as it did.
      const res = await harness.app.fetch(get(SESSION, asBootstrap()))
      const state = (await res.json()) as AuthState
      expect(state.org.id).toBe(DEFAULT_ORG_ID)
      expect(state.role).toBe('admin')
    })

    it('reports the default org without ever writing its row', async () => {
      const state = await authState(harness, await signIn(harness))
      expect(state.org).toStrictEqual({
        id: DEFAULT_ORG_ID,
        slug: 'default',
        name: 'Default',
        createdAt: 0,
      })
      // Synthesised, not stored: the route every page polls must not be a write.
      expect(await harness.container.stores.orgs.list()).toStrictEqual([])
    })

    it('binds a session to the org its sign-in named', async () => {
      const made = await makeOrg(harness, 'acme', 'Acme')
      const state = await authState(harness, await signIn(harness, 'acme'))
      expect(state.org).toStrictEqual(made)
    })

    // The one slug every caller can read off their own auth state, and the only
    // one nobody is allowed to create. A sign-in that refused it would refuse
    // the org it is describing.
    it('signs somebody in to the default org by its slug, row or no row', async () => {
      const state = await authState(harness, await signIn(harness, 'default'))
      expect(state.org.id).toBe(DEFAULT_ORG_ID)
      expect(await harness.container.stores.orgs.list()).toStrictEqual([])
    })

    it('refuses a sign-in to an org nobody made rather than falling back', async () => {
      // A quiet fall back to the default org would sign somebody in to a board
      // they did not ask for, and the two states look identical afterwards.
      const res = await harness.app.fetch(get('/api/v1/auth/sign-in/github?org=nowhere'))
      expect(res.status).toBe(404)
    })
  })

  describe('what a session can reach', () => {
    it('shows a session its own org and not the one next to it', async () => {
      await makeOrg(harness, 'acme')
      const other = withOrg(harness.container, DEFAULT_ORG_ID)
      await other.repositories.reviewers.create({
        id: 'r-default',
        displayName: 'Somebody Else',
        handles: { github: null, gitlab: null },
        slackUserId: null,
        team: null,
        skills: [],
        availability: 'available',
        role: 'member',
        weight: 1,
        outstandingReviews: 0,
        createdAt: 1,
      })
      // Signing in to `acme` claims the account there, so the directory holds
      // exactly the one person and never the default org's.
      expect(await reviewersOn(harness, await signIn(harness, 'acme'))).toStrictEqual(['ada'])
      expect(await reviewersOn(harness, await signIn(harness))).toContain('Somebody Else')
    })

    it('makes one host account a separate person in each org', async () => {
      await makeOrg(harness, 'acme')
      const here = await authState(harness, await signIn(harness))
      const there = await authState(harness, await signIn(harness, 'acme'))
      const idOf = (state: AuthState): string =>
        state.principal.kind === 'session' ? state.principal.viewer.reviewer.id : 'none'
      expect(idOf(here)).not.toBe(idOf(there))
    })
  })

  describe('roles', () => {
    it('makes the first person into an org its admin', async () => {
      await makeOrg(harness, 'acme')
      expect((await authState(harness, await signIn(harness, 'acme'))).role).toBe('admin')
    })

    it('makes everybody after them a member', async () => {
      const first = closedHarness({ username: 'ada', subject: '1' })
      await signIn(first, undefined)
      // The same deployment, a second account: the directory is no longer empty.
      const second = buildHarness(
        {
          ...first.container,
          gateways: stubGateways({ signIn: everyHost(stubSignIn('grace', '2')) }),
        },
        { encryptionKey: KEY },
      )
      expect((await authState(second, await signIn(second))).role).toBe('member')
    })

    it('refuses a member the routes that configure the deployment', async () => {
      await signIn(harness, undefined)
      const second = buildHarness(
        {
          ...harness.container,
          gateways: stubGateways({ signIn: everyHost(stubSignIn('grace', '2')) }),
        },
        { encryptionKey: KEY },
      )
      const cookie = await signIn(second)
      for (const path of [ORGS, '/api/v1/settings/api-keys', '/api/v1/settings/integrations']) {
        expect((await second.app.fetch(get(path, { cookie }))).status).toBe(403)
      }
      // And still serves them the board, which is the point of the distinction.
      expect((await second.app.fetch(get('/api/v1/reviews', { cookie }))).status).toBe(200)
    })

    it('lets a member read the directory a review is assigned out of', async () => {
      await signIn(harness, undefined)
      const second = buildHarness(
        {
          ...harness.container,
          gateways: stubGateways({ signIn: everyHost(stubSignIn('grace', '2')) }),
        },
        { encryptionKey: KEY },
      )
      const cookie = await signIn(second)
      expect((await second.app.fetch(get(REVIEWERS, { cookie }))).status).toBe(200)
      // The WRITE is an admin's, because it decides who else may administer.
      const res = await second.app.fetch(post(REVIEWERS, { displayName: 'Hopper' }, { cookie }))
      expect(res.status).toBe(403)
    })
  })

  describe('pausing somebody', () => {
    it('signs them out', async () => {
      // `deleteForReviewer` existed from the day sessions did and nothing called
      // it: what pausing meant for ACCESS was the question this slice answers.
      const cookie = await signIn(harness)
      const state = await authState(harness, cookie)
      const reviewerId =
        state.principal.kind === 'session' ? state.principal.viewer.reviewer.id : ''
      const paused = await harness.app.fetch(
        new Request(`http://localhost${REVIEWERS}/${reviewerId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ availability: 'paused' }),
        }),
      )
      expect(paused.status).toBe(200)
      // The same cookie, now resolving to nobody, on a deployment that refuses one.
      expect((await harness.app.fetch(get('/api/v1/reviews', { cookie }))).status).toBe(401)
    })
  })

  describe('making one', () => {
    it('refuses a slug another org already holds', async () => {
      await makeOrg(harness, 'acme')
      const again = await harness.app.fetch(
        post(ORGS, { slug: 'acme', name: 'Acme Two' }, asBootstrap()),
      )
      expect(again.status).toBe(409)
    })

    it('refuses the default slug, which every unplaced caller lands in', async () => {
      const res = await harness.app.fetch(
        post(ORGS, { slug: 'default', name: 'Mine' }, asBootstrap()),
      )
      expect(res.status).toBe(409)
    })

    it('lists the default org beside the ones somebody made', async () => {
      await makeOrg(harness, 'acme')
      const res = await harness.app.fetch(get(ORGS, asBootstrap()))
      expect(res.status).toBe(200)
      const { orgs } = (await res.json()) as { orgs: Org[] }
      expect(orgs.map((org) => org.slug)).toStrictEqual(['default', 'acme'])
    })
  })

  describe('the reminder tick', () => {
    it('walks every org, including the default one with no row', async () => {
      const acme = await makeOrg(harness, 'acme')
      for (const orgId of [DEFAULT_ORG_ID, acme.id]) {
        const store = withOrg(harness.container, orgId).repositories
        await store.sessions.create({
          id: `s-${orgId}`,
          orgId,
          tokenDigest: `digest-${orgId}`,
          reviewerId: 'r1',
          provider: 'github',
          subject: '1',
          createdAt: 0,
          lastSeenAt: 0,
          expiresAt: 1,
        })
      }
      // One sweep per tenancy, counted together: a tick driven off the `orgs`
      // table alone would miss the default org, where a single-tenant
      // deployment's everything is.
      expect((await runReminderTick(harness.container)).sessionsSwept).toBe(2)
    })
  })
})

// The bus is ONE object per process — it has to be, on a runtime that rebuilds
// its container per request — so it is the one thing `forOrg` cannot hand out a
// scoped copy of, and the only place the boundary had to be closed by hand.
describe('the live attention stream', () => {
  it('keeps one org\u2019s subscribers off another org\u2019s events', async () => {
    const fanout = new InMemoryAttentionBus()
    const container = closedHarness().container
    const heard: string[] = []
    // A subscriber in each org, through the SCOPED view each container binds.
    withOrg({ ...container, attentionFanout: fanout }, 'org-a').bus.subscribe(() => heard.push('a'))
    withOrg({ ...container, attentionFanout: fanout }, 'org-b').bus.subscribe(() => heard.push('b'))

    withOrg({ ...container, attentionFanout: fanout }, 'org-a').bus.publish({
      kind: 'opened',
      request: attentionIn('a1'),
    })

    // Not filtered by the audience rule, which knows about skills and teams
    // and nothing about orgs: an ask with no required skills and no same-team
    // gate concerns ANY available reviewer, so a shared fan-out would have
    // pushed this onto every open stream in the process.
    expect(heard).toStrictEqual(['a'])
  })

  it('drops an org\u2019s listener set with its last stream', async () => {
    const fanout = new InMemoryAttentionBus()
    const container = closedHarness().container
    const stop = withOrg({ ...container, attentionFanout: fanout }, 'org-a').bus.subscribe(() => {})
    expect(fanout.subscriberCount('org-a')).toBe(1)
    stop()
    // A process that has served a thousand tenancies must not hold a thousand
    // empty sets for ever.
    expect(fanout.subscriberCount('org-a')).toBe(0)
  })
})

/** An ask nobody is named in and no skill gates: what every available reviewer concerns. */
function attentionIn(id: string) {
  return {
    id,
    pullRequest: {
      provider: 'github' as const,
      owner: 'platform',
      repo: 'api',
      number: 12,
      url: 'https://github.com/platform/api/pull/12',
    },
    title: `Attention ${id}`,
    requestedById: 'r1',
    requestedByName: 'Somebody',
    requiredSkills: [],
    sameTeamOnly: false,
    team: null,
    neededCommitments: 1,
    commitments: [],
    note: null,
    status: 'open' as const,
    createdAt: 1_000,
    updatedAt: 1_000,
    resolvedAt: null,
  }
}
