import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// A smoke suite, deliberately thin. The behaviour lives in @sainte-beuve/server and
// is tested there; what only this suite can tell us is that the bundle boots on
// workerd and that the facade's own wiring (routes mounted, capabilities read off
// the env) survives the runtime.
describe('sainte-beuve worker', () => {
  it('serves the health probe', async () => {
    const res = await SELF.fetch('https://example.com/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({
      status: 'ok',
      // Nothing is configured in the test env, so every optional capability is off.
      capabilities: { chat: false, vcs: false, aiReview: false },
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

  it('answers the error envelope for an unknown route', async () => {
    const res = await SELF.fetch('https://example.com/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
