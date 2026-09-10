/**
 * Slack request signing (`v0` scheme). Interactivity and slash commands arrive as
 * plain signed POSTs to our own routes, so this is the gate on all of them.
 *
 * WebCrypto rather than `node:crypto` so the same code runs inside workerd.
 */

/** Reject a replayed request older than this. Slack's own guidance is five minutes. */
const MAX_SKEW_SECONDS = 5 * 60

export async function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  headers: { timestamp: string | null; signature: string | null },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { timestamp, signature } = headers
  if (timestamp === null || signature === null) return false
  const sent = Number.parseInt(timestamp, 10)
  if (Number.isNaN(sent) || Math.abs(nowSeconds - sent) > MAX_SKEW_SECONDS) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  )
  return constantTimeEquals(`v0=${toHex(new Uint8Array(mac))}`, signature)
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Length-independent compare: the loop runs over the expected value either way. */
function constantTimeEquals(expected: string, actual: string): boolean {
  let diff = expected.length ^ actual.length
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0)
  }
  return diff === 0
}
