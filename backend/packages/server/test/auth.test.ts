import type { ApiKeyList, AuthState, IssuedApiKey, Viewer } from '@sainte-beuve/contracts'
import { vcsOauthCredentialKey } from '@sainte-beuve/contracts'
import type { VcsIdentityGateway } from '@sainte-beuve/kernel'
import { DEFAULT_SESSION_LIFETIME_MS } from '../src/container.js'
import { runReminderTick } from '../src/reminders/tick.js'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addReviewer,
  buildHarness,
  del,
  environmentVcs,
  everyHost,
  get,
  post,
  stubGateways,
  type TestHarness,
  viewerVcs,
} from './helpers.js'

/**
 * Who may call this deployment, and as whom.
 *
 * Through `app.fetch` like every other suite here, which is what makes these
 * cases worth writing: authentication is a middleware, a cookie and a header,
 * and none of the three exists below the HTTP boundary. A service-level suite
 * would prove the session lookup and miss the guard that decides whether the
 * lookup happens at all.
 */

const KEY = btoa('0123456789abcdef0123456789abcdef')
const SESSION = '/api/v1/auth/session'
const KEYS = '/api/v1/settings/api-keys'

/** A sign-in that returns a fixed account, so a round trip can be walked. */
function stubSignIn(username = 'kibertoad'): VcsIdentityGateway {
  return {
    authorizeUrl: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    exchangeCode: async ({ code }) => ({
      token: `gho_${code}_token`,
      account: { subject: '4249249', username, displayName: 'Igor', avatarUrl: null },
    }),
  }
}

/** A deployment somebody can actually sign in to: an OAuth client and a key to sign the state. */
function signable(overrides: Parameters<typeof buildHarness>[0] = {}): TestHarness {
  return buildHarness(
    { gateways: stubGateways({ signIn: everyHost(stubSignIn()) }), ...overrides },
    { encryptionKey: KEY },
  )
}

async function authState(
  harness: TestHarness,
  headers: Record<string, string> = {},
): Promise<AuthState> {
  const res = await harness.app.fetch(new Request(`http://localhost${SESSION}`, { headers }))
  expect(res.status).toBe(200)
  return (await res.json()) as AuthState
}

/**
 * Walk a sign-in and hand back the cookie the callback set.
 *
 * The cookie is the whole of what a browser keeps, so reading it back off the
 * response and presenting it on the next request is exactly what a browser does
 * and is the only honest way to exercise the session.
 */
async function signIn(harness: TestHarness, path: string): Promise<string> {
  const start = await harness.app.fetch(get(path))
  expect(start.status).toBe(200)
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')
  const callback = await harness.app.fetch(
    get(`/connect/github/callback?code=abc&state=${encodeURIComponent(state ?? '')}`),
  )
  const cookie = callback.headers.get('set-cookie')
  expect(cookie).toContain('sb_session=')
  return (cookie ?? '').split(';')[0] ?? ''
}

describe('who is calling', () => {
  describe('an open deployment', () => {
    let harness: TestHarness

    beforeEach(() => {
      harness = buildHarness()
    })

    it('tells a caller it cannot identify that it is nobody', async () => {
      // Never refused, in either mode: a screen that had to be signed in to
      // find out that it is not signed in has nowhere to start.
      expect(await authState(harness)).toStrictEqual({
        mode: 'open',
        principal: { kind: 'anonymous' },
        signInProviders: [],
      })
    })

    it('serves the board to a caller it cannot identify', async () => {
      const res = await harness.app.fetch(get('/api/v1/reviews'))
      expect(res.status).toBe(200)
    })

    it('offers a sign-in only where one could be finished', async () => {
      // An OAuth client AND a key to sign the round trip with: half of either
      // is a button that fails at the callback.
      expect((await authState(signable())).signInProviders).toStrictEqual(['github', 'gitlab'])
      const unkeyed = buildHarness({ gateways: stubGateways({ signIn: everyHost(stubSignIn()) }) })
      expect((await authState(unkeyed)).signInProviders).toStrictEqual([])
    })
  })

  describe('a deployment that insists', () => {
    let harness: TestHarness

    beforeEach(() => {
      harness = signable({ auth: { ...buildHarness().container.auth, mode: 'required' } })
    })

    it('refuses an anonymous call and names both ways in', async () => {
      const res = await harness.app.fetch(get('/api/v1/reviews'))
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('unauthenticated')
      expect(body.error.message).toContain('Authorization: Bearer')
    })

    it('still answers the routes a sign-in needs', async () => {
      expect((await authState(harness)).principal).toStrictEqual({ kind: 'anonymous' })
      const start = await harness.app.fetch(get('/api/v1/auth/sign-in/github'))
      expect(start.status).toBe(200)
    })

    it('lets the deployment key in, and nothing that looks like it', async () => {
      const keyed = signable({
        auth: { ...harness.container.auth, mode: 'required', environmentApiKey: 'sbk_the-key' },
      })
      const allowed = await keyed.app.fetch(
        new Request('http://localhost/api/v1/reviews', {
          headers: { authorization: 'Bearer sbk_the-key' },
        }),
      )
      expect(allowed.status).toBe(200)
      const refused = await keyed.app.fetch(
        new Request('http://localhost/api/v1/reviews', {
          headers: { authorization: 'Bearer sbk_the-keyy' },
        }),
      )
      expect(refused.status).toBe(401)
    })
  })

  describe('a session', () => {
    it('is what the viewer is, rather than the deployment credential', async () => {
      // The deployment's own credential acts as somebody ELSE, which is the
      // whole point: before this, everybody's workspace rendered as that
      // account. A signed-in caller is themselves.
      const harness = signable({ vcs: environmentVcs(viewerVcs('deployment-bot')) })
      const cookie = await signIn(harness, '/api/v1/auth/sign-in/github')

      const anonymous = await harness.app.fetch(get('/api/v1/me'))
      expect(((await anonymous.json()) as Viewer).reviewer.handles.github).toBe('deployment-bot')

      const mine = await harness.app.fetch(
        new Request('http://localhost/api/v1/me', { headers: { cookie } }),
      )
      expect(((await mine.json()) as Viewer).reviewer.handles.github).toBe('kibertoad')
    })

    it('adopts the directory row somebody was already registered as', async () => {
      const harness = signable()
      const existing = await addReviewer(harness, {
        displayName: 'Igor',
        handles: { github: 'kibertoad' },
        skills: ['payments'],
      })
      const cookie = await signIn(harness, '/api/v1/auth/sign-in/github')
      const state = await authState(harness, { cookie })
      expect(state.principal.kind).toBe('session')
      if (state.principal.kind !== 'session') return
      // The registered row, with its skills, rather than a second person with
      // an empty one that the router would never draw.
      expect(state.principal.viewer.reviewer.id).toBe(existing.id)
      expect(state.principal.viewer.reviewer.skills).toStrictEqual(['payments'])
      expect(state.principal.session.expiresAt).toBe(
        harness.clock.now() + DEFAULT_SESSION_LIFETIME_MS,
      )
    })

    it('stores no credential when it was only a sign-in', async () => {
      const harness = signable()
      await signIn(harness, '/api/v1/auth/sign-in/github')
      // The Configuration screen's button connects the DEPLOYMENT; this one
      // proves who the caller is. One flow doing both would mean everybody who
      // signed in overwrote the credential the board runs on.
      const stored = await harness.container.repositories.integrationTokens.get(
        vcsOauthCredentialKey('github'),
      )
      expect(stored).toBeNull()
    })

    it('is established by connecting a credential too', async () => {
      const harness = signable()
      const cookie = await signIn(harness, '/api/v1/settings/connections/github/sign-in')
      expect((await authState(harness, { cookie })).principal.kind).toBe('session')
      expect(
        await harness.container.repositories.integrationTokens.get(vcsOauthCredentialKey('github')),
      ).not.toBeNull()
    })

    it('stops resolving once it is signed out', async () => {
      const harness = signable()
      const cookie = await signIn(harness, '/api/v1/auth/sign-in/github')
      const out = await harness.app.fetch(
        new Request(`http://localhost/api/v1/auth/sign-out`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(out.status).toBe(200)
      expect(((await out.json()) as AuthState).principal).toStrictEqual({ kind: 'anonymous' })
      expect((await authState(harness, { cookie })).principal).toStrictEqual({ kind: 'anonymous' })
    })

    it('stops resolving once it has expired, and the tick clears the row', async () => {
      const harness = signable()
      const cookie = await signIn(harness, '/api/v1/auth/sign-in/github')
      harness.clock.advance(DEFAULT_SESSION_LIFETIME_MS + 1)
      expect((await authState(harness, { cookie })).principal).toStrictEqual({ kind: 'anonymous' })
      // The read already dropped it, so the sweep has nothing left to take:
      // whichever runs first, the other finds the table clean.
      expect(await runReminderTick(harness.container)).toMatchObject({ sessionsSwept: 0 })
    })
  })

  describe('an API key', () => {
    let harness: TestHarness

    beforeEach(() => {
      harness = buildHarness()
    })

    async function mint(label = 'release pipeline'): Promise<IssuedApiKey> {
      const res = await harness.app.fetch(post(KEYS, { label }))
      expect(res.status).toBe(201)
      return (await res.json()) as IssuedApiKey
    }

    it('is readable once, and afterwards only by its label and tail', async () => {
      const { key, token } = await mint()
      expect(token.startsWith('sbk_')).toBe(true)
      expect(key.hint).toBe(token.slice(-4))
      const listed = await harness.app.fetch(get(KEYS))
      const body = (await listed.json()) as ApiKeyList
      expect(body.apiKeys).toStrictEqual([{ ...key, lastUsedAt: null }])
      // Nothing in the listing can be presented as a credential.
      expect(JSON.stringify(body)).not.toContain(token)
    })

    it('identifies the machine holding it', async () => {
      const { key, token } = await mint()
      const state = await authState(harness, { authorization: `Bearer ${token}` })
      expect(state.principal).toStrictEqual({
        kind: 'api_key',
        keyId: key.id,
        label: 'release pipeline',
      })
    })

    it('is not a person, so the workspace refuses it by name', async () => {
      const { token } = await mint()
      const res = await harness.app.fetch(
        new Request('http://localhost/api/v1/me', {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
      expect(res.status).toBe(403)
      expect(await res.text()).toContain('An API key is not a person')
    })

    it('stops working the moment it is revoked', async () => {
      const { key, token } = await mint()
      const revoked = await harness.app.fetch(del(`${KEYS}/${key.id}`))
      expect(revoked.status).toBe(200)
      expect(((await revoked.json()) as ApiKeyList).apiKeys).toStrictEqual([])
      expect(
        (await authState(harness, { authorization: `Bearer ${token}` })).principal,
      ).toStrictEqual({ kind: 'anonymous' })
    })

    it('cannot revoke the one the deployment carries in its environment', async () => {
      const keyed = buildHarness({
        auth: { ...harness.container.auth, environmentApiKey: 'sbk_the-key' },
      })
      const res = await keyed.app.fetch(del(`${KEYS}/environment`))
      // A validation error naming the variable, rather than the 404 that would
      // send an operator looking for a row that was never there.
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('AUTH_API_KEY')
    })
  })
})
