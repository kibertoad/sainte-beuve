/**
 * Slack request signing (`v0` scheme). Interactivity and slash commands arrive as
 * plain signed POSTs to our own routes, so this is the gate on all of them.
 *
 * WebCrypto rather than `node:crypto` so the same code runs inside workerd.
 */

/** Reject a replayed request older than this. Slack's own guidance is five minutes. */
const MAX_SKEW_SECONDS = 5 * 60

/** The two headers Slack signs with, once both are there and the timestamp is fresh. */
export interface SlackSignatureHeaders {
  timestamp: string
  signature: string
}

/**
 * The half of verification that needs NO SECRET: both headers present, the
 * timestamp a number, and within the replay window.
 *
 * Split out and exported because of what it costs to get the secret on a
 * multi-tenant deployment. The secret is an org's credential now, so resolving
 * one is a store read plus an HKDF derivation and an AES-GCM open — on a route
 * that is unauthenticated by construction, where every byte arrived from a
 * stranger. A caller that asks this first pays none of that for a POST carrying
 * no signature at all, or one replayed from last week.
 *
 * It is not a defence against a crafted request: a forged signature with a fresh
 * timestamp still costs one resolution, and it has to, because the secret is what
 * the forgery is checked against. What it removes is the cheapest flood.
 */
export function readSlackSignatureHeaders(
  headers: { timestamp: string | null; signature: string | null },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SlackSignatureHeaders | null {
  const { timestamp, signature } = headers
  if (timestamp === null || signature === null) return null
  const sent = Number.parseInt(timestamp, 10)
  if (Number.isNaN(sent) || Math.abs(nowSeconds - sent) > MAX_SKEW_SECONDS) return null
  return { timestamp, signature }
}

export async function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  headers: { timestamp: string | null; signature: string | null },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  // Re-read rather than trusted from the caller: this stays safe on its own, and
  // a caller that already checked pays a string compare for the second look.
  const signed = readSlackSignatureHeaders(headers, nowSeconds)
  if (signed === null) return false

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
    new TextEncoder().encode(`v0:${signed.timestamp}:${rawBody}`),
  )
  return constantTimeEquals(`v0=${toHex(new Uint8Array(mac))}`, signed.signature)
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
