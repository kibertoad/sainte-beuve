import { timingSafeEqual } from '@sainte-beuve/kernel'

/**
 * GitHub webhook verification.
 *
 * Every inbound delivery passes through here before anything parses it, because
 * the signature is computed over the exact bytes GitHub sent: parsing first and
 * re-serialising changes them. What a verified delivery MEANS is
 * `interpretGitHubDelivery` in events.ts.
 *
 * Written against WebCrypto rather than `node:crypto` because it has to run
 * unchanged inside workerd.
 */

/**
 * Verify `X-Hub-Signature-256` against the raw body.
 *
 * The comparison is length-independent by hand, so a mismatch leaks nothing
 * through timing. (WebCrypto's `verify` would do the constant-time compare for
 * us, and is not used because it throws on a signature of the wrong LENGTH,
 * where a hand-rolled compare answers false.)
 */
export async function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const provided = hexToBytes(signatureHeader.slice('sha256='.length))
  if (provided === null) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return timingSafeEqual(new Uint8Array(expected), provided)
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    bytes[i] = byte
  }
  return bytes
}
