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

  it('answers the error envelope for an unknown route', async () => {
    const res = await SELF.fetch('https://example.com/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
