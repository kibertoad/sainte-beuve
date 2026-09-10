import { describe, expect, it } from 'vitest'
import { verifyGitHubSignature } from './webhooks.js'

// The gate every inbound delivery passes. What a verified delivery MEANS is
// events.test.ts.

const SECRET = 'github-webhook-secret'
const BODY = '{"action":"opened"}'

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

describe('verifyGitHubSignature', () => {
  it('accepts a correctly signed body', async () => {
    expect(await verifyGitHubSignature(SECRET, BODY, await sign(BODY))).toBe(true)
  })

  it('rejects a signature made with another secret', async () => {
    expect(await verifyGitHubSignature(SECRET, BODY, await sign(BODY, 'other'))).toBe(false)
  })

  it('rejects a body that was altered after signing', async () => {
    const signature = await sign(BODY)
    expect(await verifyGitHubSignature(SECRET, '{"action":"closed"}', signature)).toBe(false)
  })

  it('rejects a missing or malformed header', async () => {
    // A signature of the wrong LENGTH answers false rather than throwing, which
    // is why the compare is hand-rolled instead of using `crypto.subtle.verify`.
    expect(await verifyGitHubSignature(SECRET, BODY, null)).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha1=deadbeef')).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha256=zz')).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha256=')).toBe(false)
    expect(await verifyGitHubSignature(SECRET, BODY, 'sha256=abc')).toBe(false)
  })
})
