import type { IntegrationTokenStatus } from '@sainte-beuve/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
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
    expect(await listIntegrations(harness)).toStrictEqual([
      { integrationId: 'cat-factory', state: 'absent', hint: null, updatedAt: null },
    ])
  })

  it('stores a token and reports it by its last four characters only', async () => {
    const res = await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      integrationId: 'cat-factory',
      state: 'stored',
      hint: '5b4a',
      updatedAt: harness.clock.now(),
    })

    expect(await listIntegrations(harness)).toStrictEqual([
      {
        integrationId: 'cat-factory',
        state: 'stored',
        hint: '5b4a',
        updatedAt: harness.clock.now(),
      },
    ])
  })

  it('never hands the token back, and never stores it in the clear', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    const listed = await harness.app.fetch(new Request(`http://localhost${PATH}`))
    expect(await listed.text()).not.toContain(TOKEN)

    const stored = await harness.container.repositories.integrationTokens.get('cat-factory')
    expect(stored?.sealed).not.toContain(TOKEN)
    expect(await harness.container.secrets?.decrypt(stored!.sealed)).toBe(TOKEN)
  })

  it('replaces the stored token rather than keeping the first one', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    await harness.app.fetch(put(TOKEN_PATH, { token: 'cf_live_0000zzzz' }))

    const stored = await harness.container.repositories.integrationTokens.get('cat-factory')
    expect(await harness.container.secrets?.decrypt(stored!.sealed)).toBe('cf_live_0000zzzz')
    expect((await listIntegrations(harness))[0]?.hint).toBe('zzzz')
  })

  it('refuses to store anything when the deployment configured no encryption key', async () => {
    const unkeyed = buildHarness()
    const res = await unkeyed.app.fetch(put(TOKEN_PATH, { token: TOKEN }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: { code: 'unavailable', message: expect.stringContaining('SETTINGS_ENCRYPTION_KEY') },
    })
  })

  it('reports a token sealed under a rotated key as unreadable, not as missing', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    // The same store, a different key: what a rotated SETTINGS_ENCRYPTION_KEY leaves behind.
    const rotated = buildHarness({
      repositories: harness.container.repositories,
      secrets: cipherFor(ROTATED_KEY),
    })
    expect((await listIntegrations(rotated))[0]).toMatchObject({
      state: 'unreadable',
      hint: '5b4a',
    })
  })

  it('clears a token even when the key that sealed it is gone', async () => {
    await harness.app.fetch(put(TOKEN_PATH, { token: TOKEN }))

    const unkeyed = buildHarness({ repositories: harness.container.repositories })
    const res = await unkeyed.app.fetch(del(TOKEN_PATH))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      integrationId: 'cat-factory',
      state: 'absent',
      hint: null,
      updatedAt: null,
    })
    expect(await listIntegrations(unkeyed)).toStrictEqual([
      { integrationId: 'cat-factory', state: 'absent', hint: null, updatedAt: null },
    ])
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
