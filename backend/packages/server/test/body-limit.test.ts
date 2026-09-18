import { describe, expect, it } from 'vitest'
import { buildHarness } from './helpers.js'

// The unauthenticated webhook routes buffer the raw body and HMAC it before a
// signature can refuse anything, so the size limit is the only thing between a
// stranger's POST and a Node process's memory. Workers are capped by the
// platform; the same app serves both, so the cap lives in the app.

function post(path: string, bytes: number): Request {
  const body = JSON.stringify({ padding: 'x'.repeat(bytes) })
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('request body limits', () => {
  it('refuses an oversized delivery at the GitHub webhook, before the signature is checked', async () => {
    const { app } = buildHarness()

    const response = await app.fetch(post('/webhooks/github', 2 * 1024 * 1024))

    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('payload_too_large')
  })

  it('refuses an oversized delivery at the Slack webhook', async () => {
    const { app } = buildHarness()

    expect((await app.fetch(post('/webhooks/slack', 2 * 1024 * 1024))).status).toBe(413)
  })

  it('holds a JSON route to the tighter limit', async () => {
    const { app } = buildHarness()

    expect((await app.fetch(post('/api/v1/reviews', 256 * 1024))).status).toBe(413)
  })

  it('leaves an ordinary body alone', async () => {
    const { app } = buildHarness()

    // Refused for being unsigned rather than for being long, which is the point:
    // the limit must not be what a real delivery trips over.
    expect((await app.fetch(post('/webhooks/github', 1024))).status).not.toBe(413)
  })
})
