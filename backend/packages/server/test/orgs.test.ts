import type {
  AuthState,
  Org,
  Reviewer,
  VcsHandlesInput,
  VcsProvider,
} from '@sainte-beuve/contracts'
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
  patch,
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
const PROJECTS = '/api/v1/projects'
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
async function signIn(
  harness: TestHarness,
  org?: string,
  provider: VcsProvider = 'github',
): Promise<string> {
  const jar = cookieJar()
  const start = await harness.app.fetch(get(signInPath(org, provider)))
  expect(start.status).toBe(200)
  jar.keep(start)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
  const callback = await harness.app.fetch(
    get(
      `/connect/${provider}/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
      jar.headers(),
    ),
  )
  expect(callback.headers.get('set-cookie')).toContain('sb_session=')
  jar.keep(callback)
  return jar.headers().cookie ?? ''
}

/**
 * Walk a sign-in that may be REFUSED, and hand back the callback's answer.
 *
 * Beside `signIn` rather than replacing it, because the two are different
 * assertions: one says "this is what a browser keeps", and this one says "this
 * deployment would not let that browser in".
 */
async function attemptSignIn(
  harness: TestHarness,
  org?: string,
  provider: VcsProvider = 'github',
): Promise<Response> {
  const jar = cookieJar()
  const start = await harness.app.fetch(get(signInPath(org, provider)))
  expect(start.status).toBe(200)
  jar.keep(start)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
  return harness.app.fetch(
    get(
      `/connect/${provider}/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
      jar.headers(),
    ),
  )
}

/** Where a sign-in starts, on the host it starts from and into the org it names. */
function signInPath(org: string | undefined, provider: VcsProvider): string {
  const path = `/api/v1/auth/sign-in/${provider}`
  return org === undefined ? path : `${path}?org=${org}`
}

/** The same deployment seen by a second host account. */
function asAccount(harness: TestHarness, username: string, subject: string): TestHarness {
  return buildHarness(
    {
      ...harness.container,
      gateways: stubGateways({ signIn: everyHost(stubSignIn(username, subject)) }),
    },
    { encryptionKey: KEY },
  )
}

/** What an admin may say about somebody they are registering, beyond the handle. */
interface Registration {
  role?: 'admin' | 'member'
  /** Replaces the default `{ github: handle }`, for a person known on both hosts. */
  handles?: VcsHandlesInput
}

/** Register somebody by hand, which is what `invite` enrolment is an invitation from. */
async function register(
  harness: TestHarness,
  headers: Record<string, string>,
  handle: string,
  registration: Registration = {},
): Promise<Reviewer> {
  const { role = 'member', handles = { github: handle } } = registration
  const res = await harness.app.fetch(
    post(REVIEWERS, { displayName: handle, handles, role }, headers),
  )
  expect(res.status).toBe(201)
  return (await res.json()) as Reviewer
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
        enrolment: 'invite',
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
      // The default org first, so this account is its founder rather than a
      // stranger its enrolment would refuse. See `decideEnrolment`.
      const here = await signIn(harness)
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
      expect(await reviewersOn(harness, here)).toContain('Somebody Else')
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

    it('makes everybody the admin registered after them a member', async () => {
      const founder = await signIn(harness, undefined)
      await register(harness, { cookie: founder }, 'grace')
      const second = asAccount(harness, 'grace', '2')
      expect((await authState(second, await signIn(second))).role).toBe('member')
    })

    it('refuses a member the routes that configure the deployment', async () => {
      const founder = await signIn(harness, undefined)
      await register(harness, { cookie: founder }, 'grace')
      const second = asAccount(harness, 'grace', '2')
      const cookie = await signIn(second)
      for (const path of [ORGS, '/api/v1/settings/api-keys', '/api/v1/settings/integrations']) {
        expect((await second.app.fetch(get(path, { cookie }))).status).toBe(403)
      }
      // And still serves them the board, which is the point of the distinction.
      expect((await second.app.fetch(get('/api/v1/reviews', { cookie }))).status).toBe(200)
    })

    it('lets a member read the directory a review is assigned out of', async () => {
      const founder = await signIn(harness, undefined)
      await register(harness, { cookie: founder }, 'grace')
      const second = asAccount(harness, 'grace', '2')
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

  describe('the project registry', () => {
    const REF = { provider: 'github', owner: 'acme', repo: 'payments' }

    it('refuses a repository another org registered first', async () => {
      // An inbound delivery carries no credential of ours, so the registry is
      // what places it: the oldest claim wins, and without this the org that
      // registers somebody else's repository first quietly collects its pull
      // requests, its reviewer assignments and its AI-review spend.
      expect((await harness.app.fetch(post(PROJECTS, REF, asBootstrap()))).status).toBe(201)
      await makeOrg(harness, 'acme')
      const cookie = await signIn(harness, 'acme')

      const res = await harness.app.fetch(post(PROJECTS, REF, { cookie }))
      expect(res.status).toBe(409)
      // The refusal names no org: which tenancy holds a claim is not a caller's
      // business, and saying would make this route an enumeration of the
      // deployment.
      expect(JSON.stringify(await res.json())).not.toContain(DEFAULT_ORG_ID)
    })

    it('leaves an unclaimed repository to whoever registers it', async () => {
      await makeOrg(harness, 'acme')
      const cookie = await signIn(harness, 'acme')
      expect((await harness.app.fetch(post(PROJECTS, REF, { cookie }))).status).toBe(201)
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

// H1 and H2 of docs/security-review.md: before this, completing an OAuth round
// trip WAS the authorisation. Any GitHub or GitLab account could sign in to any
// org whose slug it knew, and a pre-registered row handed its role — `admin`
// included — to whoever held the username.
describe('who may join', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = closedHarness()
  })

  it('refuses an account nobody registered', async () => {
    await signIn(harness, undefined)
    const stranger = asAccount(harness, 'mallory', '9')

    const res = await attemptSignIn(stranger)
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).not.toContain('sb_session=')
    // And the refusal does not leave a directory row behind either.
    expect(await harness.container.repositories.reviewers.list()).toHaveLength(1)
  })

  it('admits whoever an admin registered, by handle', async () => {
    const founder = await signIn(harness, undefined)
    await register(harness, { cookie: founder }, 'grace')
    const second = asAccount(harness, 'grace', '2')

    const state = await authState(second, await signIn(second))
    // Adopted rather than forked: one row, and it is the one the admin set up.
    expect(await harness.container.repositories.reviewers.list()).toHaveLength(2)
    expect(state.principal.kind === 'session' && state.principal.viewer.reviewer.role).toBe(
      'member',
    )
  })

  it('does not hand admin to a handle once an admin has signed in', async () => {
    const founder = await signIn(harness, undefined)
    // The documented workflow, and the trap in it: a typo, a released login or
    // simply the wrong Bob would otherwise inherit the role permanently.
    await register(harness, { cookie: founder }, 'grace', { role: 'admin' })
    const second = asAccount(harness, 'grace', '2')

    expect((await authState(second, await signIn(second))).role).toBe('member')
  })

  it('admits anybody where an admin opened enrolment', async () => {
    const founder = await signIn(harness, undefined)
    const opened = await harness.app.fetch(
      patch(`${ORGS}/current`, { enrolment: 'open' }, { cookie: founder }),
    )
    expect(opened.status).toBe(200)
    expect(((await opened.json()) as Org).enrolment).toBe('open')

    const stranger = asAccount(harness, 'mallory', '9')
    expect((await authState(stranger, await signIn(stranger))).role).toBe('member')
  })

  it('seats the founder an operator named, so nobody wins the org by racing', async () => {
    const res = await harness.app.fetch(
      post(
        ORGS,
        { slug: 'acme', name: 'Acme', founder: { provider: 'github', handle: 'ada' } },
        asBootstrap(),
      ),
    )
    expect(res.status).toBe(201)

    // Whoever else knows the slug is not the founder, and the directory is no
    // longer empty, so there is nothing for them to found.
    const stranger = asAccount(harness, 'mallory', '9')
    expect((await attemptSignIn(stranger, 'acme')).status).toBe(403)
    // And the account the operator named takes the row, with its role.
    expect((await authState(harness, await signIn(harness, 'acme'))).role).toBe('admin')
  })

  it('lets somebody already inside add their account on a second host', async () => {
    // The other half of H2, and the one it overshot: a claim is spent PER HOST.
    // Adoption is the only thing that ever links a second account — `refresh`
    // re-records the handle of a provider already linked and nothing else — so
    // skipping every row that any account had proved itself against left a
    // person who signed in with GitHub unable to add their GitLab account at
    // all: 403 forever under `invite`, and under `open` a second directory row,
    // which is the fork adoption exists to prevent.
    const founder = await signIn(harness, undefined)
    await register(harness, { cookie: founder }, 'grace', {
      handles: { github: 'grace', gitlab: 'grace-gl' },
    })
    const onGitHub = asAccount(harness, 'grace', '2')
    await signIn(onGitHub)

    const onGitLab = asAccount(harness, 'grace-gl', '20')
    const state = await authState(onGitLab, await signIn(onGitLab, undefined, 'gitlab'))

    // One person, not two: the same row, reached from the other host.
    const directory = await harness.container.repositories.reviewers.list()
    expect(directory).toHaveLength(2)
    expect(directory.map((row) => row.displayName).sort()).toStrictEqual(['ada', 'grace'])
    expect(state.principal.kind === 'session' && state.principal.viewer.reviewer.displayName).toBe(
      'grace',
    )
  })

  it('does not demote an admin who signs in on their second host', async () => {
    // Their own row, already linked on the first host, so the cap has no
    // unclaimed registration to protect: applying it here would take an org's
    // administrator away for connecting a GitLab account.
    const founder = await signIn(harness, undefined)
    const [ada] = await harness.container.repositories.reviewers.list()
    const named = await harness.app.fetch(
      patch(
        `${REVIEWERS}/${ada?.id ?? ''}`,
        { handles: { github: 'ada', gitlab: 'ada-gl' } },
        { cookie: founder },
      ),
    )
    expect(named.status).toBe(200)

    const onGitLab = asAccount(harness, 'ada-gl', '10')
    expect((await authState(onGitLab, await signIn(onGitLab, undefined, 'gitlab'))).role).toBe(
      'admin',
    )
    expect(await harness.container.repositories.reviewers.list()).toHaveLength(1)
  })

  it('still refuses a stranger holding a handle nobody registered on that host', async () => {
    // Per host cuts both ways. `grace` is registered on GitHub only, so whoever
    // holds the GitLab login `grace` is matched by nothing and is a stranger.
    const founder = await signIn(harness, undefined)
    await register(harness, { cookie: founder }, 'grace')
    const impostor = asAccount(harness, 'grace', '99')

    expect((await attemptSignIn(impostor, undefined, 'gitlab')).status).toBe(403)
  })

  it('refuses a second account against a row already linked on that host', async () => {
    // What H2 is actually about, and what survives: the row's GitHub slot is
    // spent, so a different GitHub account holding the same login takes nothing.
    const founder = await signIn(harness, undefined)
    await register(harness, { cookie: founder }, 'grace')
    await signIn(asAccount(harness, 'grace', '2'))

    const renamedAway = asAccount(harness, 'grace', '99')
    expect((await attemptSignIn(renamedAway)).status).toBe(403)
  })

  it('leaves an account that already signed in alone when the door closes', async () => {
    const founder = await signIn(harness, undefined)
    await register(harness, { cookie: founder }, 'grace')
    const second = asAccount(harness, 'grace', '2')
    await signIn(second)

    // Enrolment is about who may JOIN. Taking somebody's access away is
    // `availability: paused`, and it is a different route.
    const again = await attemptSignIn(second)
    expect(again.status).toBe(200)
    expect(again.headers.get('set-cookie')).toContain('sb_session=')
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
