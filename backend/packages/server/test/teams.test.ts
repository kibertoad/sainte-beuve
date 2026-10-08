import type { AuthState, Org, Reviewer, Team, TeamList } from '@sainte-beuve/contracts'
import type { VcsIdentityGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildHarness,
  cookieJar,
  del,
  everyHost,
  get,
  patch,
  post,
  stubGateways,
  type TestHarness,
} from './helpers.js'

/**
 * Teams through `app.fetch`, on a `required` deployment so a member is
 * somebody: Ada founds the org and is its admin, Bob is a member.
 */

const KEY = btoa('0123456789abcdef0123456789abcdef')
const BOOTSTRAP = 'the-operators-key'
const TEAMS = '/api/v1/teams'
const REVIEWERS = '/api/v1/reviewers'

function harnessFor(username: string, subject: string, base?: TestHarness): TestHarness {
  const signIn: VcsIdentityGateway = {
    authorizeUrl: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeCode: async ({ code }) => ({
      token: `gho_${code}_token`,
      account: { subject, username, displayName: username, avatarUrl: null },
    }),
  }
  return buildHarness(
    {
      ...base?.container,
      gateways: stubGateways({ signIn: everyHost(signIn) }),
      auth: {
        mode: 'required',
        environmentApiKey: BOOTSTRAP,
        sessionLifetimeMs: 60_000_000,
        devMode: false,
      },
    },
    { encryptionKey: KEY },
  )
}

async function signIn(harness: TestHarness): Promise<string> {
  const jar = cookieJar()
  const start = await harness.app.fetch(get('/api/v1/auth/sign-in/github'))
  jar.keep(start)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
  const callback = await harness.app.fetch(
    get(
      `/connect/github/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
      jar.headers(),
    ),
  )
  jar.keep(callback)
  return jar.headers().cookie ?? ''
}

const bootstrap = { authorization: `Bearer ${BOOTSTRAP}` }

let harness: TestHarness
let ada: { cookie: string; id: string }
let bob: { cookie: string; id: string }

async function viewerId(cookie: string): Promise<string> {
  const state = (await (
    await harness.app.fetch(get('/api/v1/auth/session', { cookie }))
  ).json()) as AuthState
  const principal = state.principal
  if (principal?.kind !== 'session') throw new Error('not signed in')
  return principal.viewer.reviewer.id
}

async function createTeam(cookie: string, body: object): Promise<Response> {
  return harness.app.fetch(post(TEAMS, body, { cookie }))
}

beforeEach(async () => {
  harness = harnessFor('ada', '1')
  const adaCookie = await signIn(harness)
  ada = { cookie: adaCookie, id: await viewerId(adaCookie) }
  await harness.app.fetch(
    post(REVIEWERS, { displayName: 'bob', handles: { github: 'bob' }, role: 'member' }, bootstrap),
  )
  const bobCookie = await signIn(harnessFor('bob', '2', harness))
  bob = { cookie: bobCookie, id: await viewerId(bobCookie) }
})

describe('teams', () => {
  it('lets a member create a team they own, and not one for somebody else', async () => {
    const created = await createTeam(bob.cookie, { name: 'Payments' })
    expect(created.status).toBe(201)
    expect(((await created.json()) as Team).ownerId).toBe(bob.id)
    expect((await createTeam(bob.cookie, { name: 'Search', ownerId: ada.id })).status).toBe(403)
    expect((await createTeam(ada.cookie, { name: 'Search', ownerId: bob.id })).status).toBe(201)
  })

  it("refuses a member changing somebody else's team, and lets an admin", async () => {
    const platform = (await (await createTeam(ada.cookie, { name: 'Platform' })).json()) as Team
    const payments = (await (await createTeam(bob.cookie, { name: 'Payments' })).json()) as Team
    const path = (team: Team) => `${TEAMS}/${team.id}`
    expect(
      (await harness.app.fetch(patch(path(platform), { name: 'Core' }, { cookie: bob.cookie })))
        .status,
    ).toBe(403)
    expect((await harness.app.fetch(del(path(platform), { cookie: bob.cookie }))).status).toBe(403)
    expect(
      (await harness.app.fetch(patch(path(payments), { name: 'Billing' }, { cookie: ada.cookie })))
        .status,
    ).toBe(200)
  })

  it('lets an owner hand a team over, after which it is no longer theirs', async () => {
    const team = (await (await createTeam(bob.cookie, { name: 'Payments' })).json()) as Team
    const handed = await harness.app.fetch(
      patch(`${TEAMS}/${team.id}`, { ownerId: ada.id }, { cookie: bob.cookie }),
    )
    expect(((await handed.json()) as Team).ownerId).toBe(ada.id)
    const after = await harness.app.fetch(
      patch(`${TEAMS}/${team.id}`, { name: 'Billing' }, { cookie: bob.cookie }),
    )
    expect(after.status).toBe(403)
  })

  it('keeps names unique regardless of case', async () => {
    await createTeam(ada.cookie, { name: 'Platform' })
    expect((await createTeam(bob.cookie, { name: 'platform' })).status).toBe(409)
  })

  it('renames a team on its reviewers, and takes a deleted one off them', async () => {
    const team = (await (await createTeam(ada.cookie, { name: 'Payments' })).json()) as Team
    const carol = (await (
      await harness.app.fetch(
        post(REVIEWERS, { displayName: 'carol', handles: {}, team: 'payments' }, bootstrap),
      )
    ).json()) as Reviewer
    // Spelled as the team spells it, whatever the request typed.
    expect(carol.team).toBe('Payments')
    await harness.app.fetch(
      patch(`${TEAMS}/${team.id}`, { name: 'Billing' }, { cookie: ada.cookie }),
    )
    expect(await teamOf(carol.id)).toBe('Billing')
    const left = await harness.app.fetch(del(`${TEAMS}/${team.id}`, { cookie: ada.cookie }))
    expect(((await left.json()) as TeamList).teams).toStrictEqual([])
    expect(await teamOf(carol.id)).toBeNull()
  })

  it('refuses a reviewer in a team that does not exist', async () => {
    const res = await harness.app.fetch(
      post(REVIEWERS, { displayName: 'dan', handles: {}, team: 'Nowhere' }, bootstrap),
    )
    expect(res.status).toBe(400)
  })
})

describe('the default repository owner', () => {
  it('is set on the org by an admin and read back on the session', async () => {
    const res = await harness.app.fetch(
      patch('/api/v1/settings/orgs/current', { defaultRepositoryOwner: 'acme' }, ada),
    )
    expect(((await res.json()) as Org).defaultRepositoryOwner).toBe('acme')
    const state = (await (
      await harness.app.fetch(get('/api/v1/auth/session', { cookie: ada.cookie }))
    ).json()) as AuthState
    expect(state.org?.defaultRepositoryOwner).toBe('acme')
    const refused = await harness.app.fetch(
      patch('/api/v1/settings/orgs/current', { defaultRepositoryOwner: 'evil' }, bob),
    )
    expect(refused.status).toBe(403)
  })
})

async function teamOf(reviewerId: string): Promise<string | null> {
  const listed = (await (await harness.app.fetch(get(REVIEWERS, bootstrap))).json()) as {
    reviewers: Reviewer[]
  }
  return listed.reviewers.find((row) => row.id === reviewerId)?.team ?? null
}
