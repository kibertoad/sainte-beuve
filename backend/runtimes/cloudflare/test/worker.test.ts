import { SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'

// A smoke suite, deliberately thin. The behaviour lives in @sainte-beuve/server and
// is tested there; what only this suite can tell us is that the bundle boots on
// workerd and that the facade's own wiring (routes mounted, capabilities read off
// the env) survives the runtime.
const TOKEN_URL = 'https://example.com/api/v1/settings/integrations/cat-factory/token'

describe('sainte-beuve worker', () => {
  // The store is module-level in this facade, and the pool's isolated storage
  // resets bindings rather than module state, so a credential stored by one case
  // would still be there for every case after it.
  afterEach(async () => {
    await SELF.fetch(TOKEN_URL, { method: 'DELETE' })
  })

  it('serves the health probe', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      status: 'ok',
      // The suite's env carries an encryption key and nothing else, so the flags
      // are read off the bindings rather than reported from a fixed table.
      capabilities: { chat: false, vcs: false, aiReview: false, secrets: true },
    })
  })

  it('serves the review board', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/reviews')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ reviews: [] })
  })

  it('lets the SPA in on the origins its bindings list', async () => {
    // wrangler.toml sets CORS_ORIGINS = "*", and the app is built once per isolate,
    // so this is also the proof that the per-request `env` still reaches the
    // origin decision.
    const res = await SELF.fetch('https://example.com/api/v1/reviews', {
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('seals and reads back a credential with the runtime Web Crypto', async () => {
    const stored = await SELF.fetch(TOKEN_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'cf_live_9f8e7d6c5b4a' }),
    })
    expect(stored.status).toBe(200)

    // `stored` (rather than `unreadable`) is the assertion that matters: it is
    // reported only after the envelope has been recognised as this key's, so this
    // covers HKDF, the key id and AES-GCM inside workerd. `inUse` stays false
    // because this Worker's bindings wire no cat-factory gateway.
    const listed = await SELF.fetch('https://example.com/api/v1/settings/integrations')
    expect(await listed.json()).toMatchObject({
      integrations: [{ integrationId: 'cat-factory', state: 'stored', hint: '5b4a', inUse: false }],
    })
  })

  it('keeps the credential routes off the wildcard its bindings list', async () => {
    // Same `CORS_ORIGINS = "*"` the board is served under, and a PUT that writes a
    // credential does not get it: an operator's browser must not be able to carry
    // a drive-by page's request into this deployment's token store.
    const preflight = await SELF.fetch(TOKEN_URL, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'PUT' },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers the error envelope for an unknown route', async () => {
    const res = await SELF.fetch('https://example.com/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
