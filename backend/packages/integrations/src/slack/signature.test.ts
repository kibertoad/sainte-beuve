import { describe, expect, it } from 'vitest'
import { verifySlackSignature } from './signature.js'

const SECRET = 'slack-signing-secret'
const BODY = 'token=x&command=%2Freview&text=assign'

async function sign(timestamp: string, body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  )
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `v0=${hex}`
}

describe('verifySlackSignature', () => {
  const now = 1_780_000_000
  const timestamp = String(now)

  it('accepts a correctly signed request', async () => {
    const signature = await sign(timestamp, BODY)
    expect(await verifySlackSignature(SECRET, BODY, { timestamp, signature }, now)).toBe(true)
  })

  it('rejects a body that was tampered with after signing', async () => {
    const signature = await sign(timestamp, BODY)
    const tampered = `${BODY}&text=approve`
    expect(await verifySlackSignature(SECRET, tampered, { timestamp, signature }, now)).toBe(false)
  })

  it('rejects a signature made with another secret', async () => {
    const signature = await sign(timestamp, BODY, 'not-the-secret')
    expect(await verifySlackSignature(SECRET, BODY, { timestamp, signature }, now)).toBe(false)
  })

  it('rejects a replay older than the skew window', async () => {
    const old = String(now - 6 * 60)
    const signature = await sign(old, BODY)
    expect(await verifySlackSignature(SECRET, BODY, { timestamp: old, signature }, now)).toBe(false)
  })

  it('rejects a request with the headers missing', async () => {
    expect(
      await verifySlackSignature(SECRET, BODY, { timestamp: null, signature: null }, now),
    ).toBe(false)
  })
})
