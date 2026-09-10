import type { IntegrationTokenStatus } from '@sainte-beuve/contracts'
import type { AiReviewGateway, SecretCipher } from '@sainte-beuve/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { WebCryptoSecretCipher } from '../src/crypto/WebCryptoSecretCipher.js'
import { type TestHarness, buildHarness, del, put } from './helpers.js'

// The Configuration screen's API, through the app: the contract validation, the
// service and the error envelope together.

const KEY = btoa('0123456789abcdef0123456789abcdef')
const ROTATED_KEY = btoa('fedcba9876543210fedcba9876543210')
const TOKEN = 'cf_live_9f8e7d6c5b4a'
const PATH = '/api/v1/settings/integrations'
const TOKEN_PATH = `${PATH}/cat-factory/token`

function cipherFor(key: string): WebCryptoSecretCipher {
  return new WebCryptoSecretCipher({ masterKeyBase64: key })
}

/** The absent status every case starts from, so a case names only what it changes. */
function status(overrides: Partial<IntegrationTokenStatus> = {}): IntegrationTokenStatus {
  return {
    integrationId: 'cat-factory',
    state: 'absent',
    unreadableReason: null,
    inUse: false,
    hint: null,
    updatedAt: null,
    ...overrides,
  }
}

async function listIntegrations(harness: TestHarness): Promise<IntegrationTokenStatus[]> {
  const res = await harness.app.fetch(new Request(`http://localhost${PATH}`))
  expect(res.status).toBe(200)
  return ((await res.json()) as { integrations: IntegrationTokenStatus[] }).integrations
}

describe('integration configuration API', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = buildHarness({ secrets: cipherFor(KEY) })
  })

  it('lists every known integration, configured or not', async () => {
    expect(await listIntegrations(harness)).toStrictEqual([status()])
  })

  it('stores a token and reports it by its last four characters only', async () => {
    const res = await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(
      status({ state: 'stored', hint: '5b4a', updatedAt: harness.clock.now() }),
    )

    expect(await listIntegrations(harness)).toStrictEqual([
      status({ state: 'stored', hint: '5b4a', updatedAt: harness.clock.now() }),
    ])
  })

  it('never hands the token back, and never stores it in the clear', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    const listed = await harness.app.fetch(new Request(`http://localhost${PATH}`))
    expect(await listed.text()).not.toContain(TOKEN)

    const stored = await harness.container.repositories.integrationTokens.get('cat-factory')
    expect(stored?.sealed).not.toContain(TOKEN)
    // Sealed AGAINST the integration id, so the envelope opens for this row only.
    expect(await harness.container.secrets?.decrypt(stored!.sealed, 'cat-factory')).toBe(TOKEN)
  })

  it('replaces the stored token rather than keeping the first one', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    await harness.app.fetch(put(TOKEN_PATH, { token: 'cf_live_0000zzzz' }))

    const stored = await harness.container.repositories.integrationTokens.get('cat-factory')
    expect(await harness.container.secrets?.decrypt(stored!.sealed, 'cat-factory')).toBe(
      'cf_live_0000zzzz',
    )
    expect((await listIntegrations(harness))[0]?.hint).toBe('zzzz')
  })

  it('reads a status without ever opening a credential', async () => {
    // A cipher that refuses to decrypt at all: a status read decides from the
    // envelope's key id, so listing must not need the plaintext of every
    // credential the deployment holds.
    const cipher = cipherFor(KEY)
    const sealOnly: SecretCipher = {
      encrypt: (plaintext, context) => cipher.encrypt(plaintext, context),
      decrypt: () => Promise.reject(new Error('a status read must not open a credential')),
      inspect: (envelope) => cipher.inspect(envelope),
    }
    const listing = buildHarness({ secrets: sealOnly })

    await listing.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect((await listIntegrations(listing))[0]).toMatchObject({ state: 'stored', hint: '5b4a' })
  })

  it('reports a stored token as not in use while the gateway comes from the environment', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect((await listIntegrations(harness))[0]).toMatchObject({ state: 'stored', inUse: false })

    const wired = buildHarness({
      repositories: harness.container.repositories,
      secrets: cipherFor(KEY),
      aiReview: {} as AiReviewGateway,
    })
    expect((await listIntegrations(wired))[0]).toMatchObject({ state: 'stored', inUse: true })
  })

  it('refuses to store anything when the deployment configured no encryption key', async () => {
    const unkeyed = buildHarness()
    const res = await unkeyed.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('SETTINGS_ENCRYPTION_KEY') },
    })
  })

  it('names a key that was refused rather than reporting it as missing', async () => {
    // The variable IS set, and this build could not use the value: telling the
    // operator to set it sends them round the same mistake again.
    const rejected = buildHarness({
      secrets: null,
      secretsRejectedReason: 'the encryption key must decode to at least 32 bytes',
    })
    const res = await rejected.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining('at least 32 bytes') },
    })
  })

  it('reports a token sealed under a rotated key as unreadable, not as missing', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    // The same store, a different key: what a rotated SETTINGS_ENCRYPTION_KEY leaves behind.
    const rotated = buildHarness({
      repositories: harness.container.repositories,
      secrets: cipherFor(ROTATED_KEY),
    })
    expect((await listIntegrations(rotated))[0]).toStrictEqual(
      status({
        state: 'unreadable',
        unreadableReason: 'key_mismatch',
        hint: '5b4a',
        updatedAt: harness.clock.now(),
      }),
    )
  })

  it('separates a key that is gone from a key that does not match', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    // No cipher at all: the fix is to configure a key, and re-entering the token
    // cannot work either, so this must not read as a rotation.
    const unkeyed = buildHarness({ repositories: harness.container.repositories })
    expect((await listIntegrations(unkeyed))[0]).toMatchObject({
      state: 'unreadable',
      unreadableReason: 'no_key',
    })
  })

  it('reports a truncated stored value as corrupt, not as a rotated key', async () => {
    await harness.container.repositories.integrationTokens.put({
      integrationId: 'cat-factory',
      sealed: 'v1.',
      hint: '5b4a',
      updatedAt: harness.clock.now(),
    })
    expect((await listIntegrations(harness))[0]).toMatchObject({
      state: 'unreadable',
      unreadableReason: 'corrupt',
    })
  })

  it('clears a token even when the key that sealed it is gone', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    const unkeyed = buildHarness({ repositories: harness.container.repositories })
    const res = await unkeyed.app.fetch(del(TOKEN_PATH))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual(status())
    expect(await listIntegrations(unkeyed)).toStrictEqual([status()])
  })

  it('keeps the routes that hold a credential off the wildcard origin', async () => {
    const preflight = (origin: string, app = harness.app) =>
      app.fetch(
        new Request(`http://localhost${TOKEN_PATH}`, {
          method: 'OPTIONS',
          headers: { origin, 'access-control-request-method': 'PUT' },
        }),
      )
    const allowed = async (origin: string, app = harness.app) =>
      (await preflight(origin, app)).headers.get('access-control-allow-origin')

    // The board answers `*` on the same app, which is the default every facade
    // ships; a route that writes a credential must not, or a page the operator
    // happens to visit can preflight this PUT and replace the stored token.
    const board = await harness.app.fetch(
      new Request('http://localhost/api/v1/reviews', {
        headers: { origin: 'https://evil.example.com' },
      }),
    )
    expect(board.headers.get('access-control-allow-origin')).toBe('*')
    expect(await allowed('https://evil.example.com')).toBeNull()
    // Loopback passes, because that is the local SPA on whatever port Nuxt took.
    expect(await allowed('http://localhost:3000')).toBe('http://localhost:3000')

    // A deployment that NAMES its SPA origin gets it here as well as on the board.
    const named = createApp({
      resolveContainer: () => harness.container,
      corsOrigins: ['https://board.example.com'],
    })
    expect(await allowed('https://board.example.com', named)).toBe('https://board.example.com')
    expect(await allowed('https://evil.example.com', named)).toBeNull()
  })

  it('refuses an integration the deployment does not know', async () => {
    const res = await harness.app.fetch(put(`${PATH}/nope/token`, { token: TOKEN }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'validation' } })
  })

  it('refuses a token too short to be one', async () => {
    const res = await harness.app.fetch(put(TOKEN_PATH, { token: 'oops' }))
    expect(res.status).toBe(400)
  })
})
