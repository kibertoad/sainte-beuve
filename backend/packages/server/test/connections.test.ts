import type { Connections, VcsConnection } from '@sainte-beuve/contracts'
import { vcsOauthCredentialKey } from '@sainte-beuve/contracts'
import type { VcsIdentityGateway } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildHarness,
  cookieJar,
  del,
  environmentVcs,
  everyHost,
  get,
  put,
  recordingVcs,
  stubGateways,
  type TestHarness,
} from './helpers.js'

// The three ways a deployment can be connected to GitHub, and the one thing the
// screen has to get right about them: which credential is actually in force.

const KEY = btoa('0123456789abcdef0123456789abcdef')
const CONNECTIONS = '/api/v1/settings/connections'
const PAT_PATH = '/api/v1/settings/integrations/github-pat/token'

/** A sign-in that returns a fixed token, and records the redirect it was given. */
function stubSignIn(): VcsIdentityGateway & { redirects: string[] } {
  const redirects: string[] = []
  return {
    redirects,
    authorizeUrl: ({ redirectUri, state }) => {
      redirects.push(redirectUri)
      return `https://github.com/login/oauth/authorize?state=${state}`
    },
    exchangeCode: async ({ code }) => ({
      token: `gho_${code}_token`,
      account: {
        subject: '4249249',
        username: 'kibertoad',
        displayName: 'Igor',
        avatarUrl: null,
      },
    }),
  }
}

/** A harness with an encryption key, which is what every connect flow needs. */
function keyed(overrides: Parameters<typeof buildHarness>[0] = {}): TestHarness {
  return buildHarness(
    { appBaseUrl: 'https://board.example.com', ...overrides },
    { encryptionKey: KEY },
  )
}

async function connections(harness: TestHarness): Promise<Connections> {
  const res = await harness.app.fetch(get(CONNECTIONS))
  expect(res.status).toBe(200)
  return (await res.json()) as Connections
}

/** The GitHub entry, which is the one every case here is about. */
async function github(harness: TestHarness): Promise<VcsConnection> {
  const found = (await connections(harness)).vcs.find((entry) => entry.provider === 'github')
  expect(found).toBeDefined()
  return found as VcsConnection
}

async function urlFrom(harness: TestHarness, path: string, jar = cookieJar()): Promise<string> {
  const res = await harness.app.fetch(get(path))
  expect(res.status).toBe(200)
  // The answer carries the flow cookie the callback will check, so a case that
  // dropped it would be walking a round trip no browser walks.
  jar.keep(res)
  return ((await res.json()) as { url: string }).url
}

/** Where a started flow sends the browser, with the cookie it was handed. */
async function startFlow(
  harness: TestHarness,
  path: string,
): Promise<{ state: string; jar: ReturnType<typeof cookieJar> }> {
  const jar = cookieJar()
  const url = new URL(await urlFrom(harness, path, jar))
  return { state: url.searchParams.get('state') ?? '', jar }
}

/** Walk the sign-in round trip and hand back what the callback answered. */
async function signIn(harness: TestHarness): Promise<Response> {
  const { state, jar } = await startFlow(harness, `${CONNECTIONS}/github/sign-in`)
  return harness.app.fetch(
    get(`/connect/github/callback?code=abc&state=${encodeURIComponent(state)}`, jar.headers()),
  )
}

describe('GitHub and Slack connections', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = keyed()
  })

  it('offers a pasted token on a deployment that has nothing else', async () => {
    const state = await github(harness)
    // Storing a token needs an encryption key and nothing more, so `pat` is what
    // a fresh keyed deployment can do; the rest need an app registration.
    expect(state.availableMethods).toStrictEqual(['pat'])
    expect(state.activeMethod).toBeNull()
    expect(state.labels).toMatchObject({ review: 'needs-review' })
  })

  it('offers nothing at all without an encryption key', async () => {
    const unkeyed = buildHarness()
    expect((await github(unkeyed)).availableMethods).toStrictEqual([])
  })

  it('reports the environment token as the credential of last resort', async () => {
    const fromEnv = keyed({ vcs: environmentVcs(recordingVcs()) })
    const state = await github(fromEnv)
    expect(state.availableMethods).toStrictEqual(['pat', 'environment'])
    expect(state.activeMethod).toBe('environment')
    // No account: the environment credential is one an operator cannot see or
    // change from the board, and it names nobody.
    expect(state.account).toBeNull()
  })

  it('lets an App shadow every other credential', async () => {
    const app = keyed({
      vcs: environmentVcs(recordingVcs()),
      gateways: stubGateways({
        vcsAsApp: everyHost(recordingVcs()),
        vcsFromToken: () => recordingVcs(),
      }),
      github: {
        appSlug: 'sainte-beuve',
        webhookSecret: 'secret',
        botLogin: null,
        labels: harness.container.github.labels,
      },
    })
    await app.app.fetch(put(PAT_PATH, { token: 'ghp_0123456789abcd' }))

    const state = await github(app)
    expect(state.availableMethods).toStrictEqual(['app', 'pat', 'environment'])
    // The App is the only credential that is not a person's, so a deployment
    // that has one uses it and the pasted token sits unused behind it.
    expect(state.activeMethod).toBe('app')
    expect(state.account).toBeNull()
    expect(state.appInstallable).toBe(true)
  })

  it('reports an App with no slug as in force but not installable', async () => {
    // The slug addresses the install PAGE; the id and the key are what calls are
    // made with. A read that dropped `app` from the methods here would name an
    // active credential it also said this deployment cannot hold, and the screen
    // would offer a button that leads nowhere.
    const slugless = keyed({
      gateways: stubGateways({ vcsAsApp: everyHost(recordingVcs()) }),
      github: { ...harness.container.github, appSlug: null },
    })
    const state = await github(slugless)
    expect(state.activeMethod).toBe('app')
    expect(state.availableMethods).toContain('app')
    expect(state.appInstallable).toBe(false)
  })

  it('sends the browser to GitHub with a state it can check on the way back', async () => {
    const identity = stubSignIn()
    const signing = keyed({ gateways: stubGateways({ signIn: everyHost(identity) }) })

    const url = new URL(await urlFrom(signing, `${CONNECTIONS}/github/sign-in`))
    expect(url.origin).toBe('https://github.com')
    expect(url.searchParams.get('state')).not.toBeNull()
    // The redirect URI names the host this request arrived on, because that is
    // the host that will receive the callback.
    expect(identity.redirects).toStrictEqual(['http://localhost/connect/github/callback'])
  })

  it('stores the credential a sign-in produced, and says whose it is', async () => {
    const signing = keyed({
      gateways: stubGateways({
        signIn: everyHost(stubSignIn()),
        vcsFromToken: () => recordingVcs(),
      }),
    })

    const callback = await signIn(signing)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(
      'https://board.example.com/configuration?connected=github',
    )

    const state = await github(signing)
    expect(state.activeMethod).toBe('oauth')
    expect(state.account).toBe('kibertoad')
    // Sealed like every other credential, and never readable back through the API.
    const stored = await signing.container.repositories.integrationTokens.get(
      vcsOauthCredentialKey('github'),
    )
    expect(stored?.sealed).not.toContain('gho_abc_token')
  })

  it('answers with a page when the deployment never said where the SPA is', async () => {
    const headless = keyed({
      appBaseUrl: null,
      gateways: stubGateways({
        signIn: everyHost(stubSignIn()),
        vcsFromToken: () => recordingVcs(),
      }),
    })
    const callback = await signIn(headless)
    expect(callback.status).toBe(200)
    expect(await callback.text()).toContain('Connected to GitHub as kibertoad')
  })

  it('refuses a callback carrying a state it never issued', async () => {
    const signing = keyed({ gateways: stubGateways({ signIn: everyHost(stubSignIn()) }) })
    const res = await signing.app.fetch(get('/connect/github/callback?code=abc&state=forged'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining('Start the connection again') },
    })
  })

  it('refuses a state minted for a different flow', async () => {
    // One signing key serves every round trip, so the install flow's state must
    // not be presentable to the sign-in callback.
    const signing = keyed({
      gateways: stubGateways({ signIn: everyHost(stubSignIn()) }),
      github: {
        appSlug: 'sainte-beuve',
        webhookSecret: null,
        botLogin: null,
        labels: harness.container.github.labels,
      },
    })
    const { state, jar } = await startFlow(signing, `${CONNECTIONS}/github/app-install`)
    // The browser's own cookie rides along, so the FLOW check refuses this.
    const res = await signing.app.fetch(
      get(`/connect/github/callback?code=abc&state=${encodeURIComponent(state)}`, jar.headers()),
    )
    expect(res.status).toBe(400)
  })

  it('says what a declined sign-in was, rather than failing silently', async () => {
    const signing = keyed({ gateways: stubGateways({ signIn: everyHost(stubSignIn()) }) })
    const res = await signing.app.fetch(get('/connect/github/callback?error=access_denied'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining('access_denied') },
    })
  })

  it('drops a sign-in credential and reports what took over', async () => {
    const signing = keyed({
      vcs: environmentVcs(recordingVcs()),
      gateways: stubGateways({
        signIn: everyHost(stubSignIn()),
        vcsFromToken: () => recordingVcs(),
      }),
    })
    await signIn(signing)
    expect((await github(signing)).activeMethod).toBe('oauth')

    const res = await signing.app.fetch(del(`${CONNECTIONS}/github/sign-in`))
    expect(res.status).toBe(200)
    // The whole connection, not an ack: dropping this credential changes which
    // one is in force, and the screen has to show what took over.
    expect(((await res.json()) as Connections).vcs).toContainEqual(
      expect.objectContaining({ provider: 'github', activeMethod: 'environment' }),
    )
  })

  it('names the missing configuration rather than offering a broken button', async () => {
    const noApp = await harness.app.fetch(get(`${CONNECTIONS}/github/app-install`))
    expect(noApp.status).toBe(503)
    expect(await noApp.json()).toMatchObject({
      error: { message: expect.stringContaining('GITHUB_APP_SLUG') },
    })

    const noOauth = await harness.app.fetch(get(`${CONNECTIONS}/github/sign-in`))
    expect(noOauth.status).toBe(503)
    expect(await noOauth.json()).toMatchObject({
      error: { message: expect.stringContaining('GITHUB_OAUTH_CLIENT_ID') },
    })
  })

  it('acknowledges an App install without storing anything', async () => {
    const withApp = keyed({
      gateways: stubGateways({ vcsAsApp: everyHost(recordingVcs()) }),
      github: {
        appSlug: 'sainte-beuve',
        webhookSecret: null,
        botLogin: null,
        labels: harness.container.github.labels,
      },
    })
    const jar = cookieJar()
    const install = new URL(await urlFrom(withApp, `${CONNECTIONS}/github/app-install`, jar))
    expect(install.pathname).toBe('/apps/sainte-beuve/installations/new')

    const state = install.searchParams.get('state') ?? ''
    const res = await withApp.app.fetch(
      get(
        `/connect/github/setup?installation_id=42&state=${encodeURIComponent(state)}`,
        jar.headers(),
      ),
    )
    expect(res.status).toBe(302)
    // Nothing is persisted: an installation is resolved from the repository it is
    // used for, so there is no binding to keep in step with GitHub.
    expect(await withApp.container.repositories.integrationTokens.list()).toStrictEqual([])
  })

  it('reports the two halves of Slack separately', async () => {
    // Posting out needs a bot token and trusting what comes back needs the
    // signing secret; a deployment with one and not the other is half wired.
    expect((await connections(harness)).slack).toStrictEqual({
      ready: false,
      announcementChannelId: null,
      interactivityReady: false,
    })

    const wired = keyed({
      chat: {
        announceReview: async () => ({ messageId: 'm' }),
        sendReminder: async () => {},
      },
      slack: { signingSecret: 'shh', announcementChannelId: 'C-reviews' },
    })
    expect((await connections(wired)).slack).toStrictEqual({
      ready: true,
      announcementChannelId: 'C-reviews',
      interactivityReady: true,
    })
  })

  it('reports whether an inbound delivery can be verified at all', async () => {
    expect((await github(harness)).webhooksReady).toBe(false)
    const verifying = keyed({
      github: { ...harness.container.github, webhookSecret: 'secret' },
    })
    expect((await github(verifying)).webhooksReady).toBe(true)
  })
})
