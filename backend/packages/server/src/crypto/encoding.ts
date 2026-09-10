/**
 * Base64url helpers built on what workerd and Node both provide natively
 * (`atob`/`btoa`, `TextEncoder`). No `node:buffer` and no `node:crypto`, so the
 * same code runs in a plain V8 isolate and in the Node service.
 */

/** Base64url-encode bytes, unpadded. */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
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
