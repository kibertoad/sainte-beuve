/**
 * Base64url helpers built on what workerd and Node both provide natively
 * (`atob`/`btoa`, `TextEncoder`). No `node:buffer` and no `node:crypto`, so the
 * same code runs in a plain V8 isolate and in the Node service.
 *
 * They live in the kernel rather than beside their first caller because three
 * packages now need the same alphabet: the at-rest cipher's envelope
 * (@sainte-beuve/server), the signed state carried through an OAuth round trip,
 * and the RS256 app JWT a GitHub App authenticates with
 * (@sainte-beuve/integrations). Two copies of a codec are two chances for one of
 * them to pad differently, and a JWT with a padded segment is refused by GitHub
 * with no hint as to why.
 */

/** Base64url-encode bytes, unpadded. */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Base64url-encode a UTF-8 string, unpadded. The JWT header and payload form. */
export function base64urlText(value: string): string {
  return base64url(new TextEncoder().encode(value))
}

/**
 * Decode base64url to bytes. Standard base64 decodes too, so an operator pasting
 * the output of `openssl rand -base64 32` does not have to know which alphabet
 * this expects. Throws on a value `atob` cannot read.
 */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Length-independent compare over two byte arrays, so a mismatch leaks nothing
 * through timing. Used wherever a signature we computed is compared against one
 * a caller sent.
 */
export function timingSafeEqual(expected: Uint8Array, actual: Uint8Array): boolean {
  let diff = expected.length ^ actual.length
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ (actual[i] ?? 0)
  return diff === 0
}
