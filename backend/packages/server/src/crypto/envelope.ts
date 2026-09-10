import { base64url, base64urlToBytes, SecretDecryptError } from '@sainte-beuve/kernel'

/**
 * The envelope `WebCryptoSecretCipher` writes, and the only place that knows its
 * shape:
 *
 *   "v1." + keyId + "." + salt + "." + iv + "." + ciphertext|tag   (base64url, unpadded)
 *
 * The version tag is what makes a later scheme change readable: an envelope
 * written by a different version is refused as corrupt instead of being fed to
 * the wrong parser.
 *
 * The key id is what makes a rotated key answerable without a key: a status
 * screen compares ids and never decrypts. It is derived from the master key
 * through HKDF, not hashed off it, so it identifies the key without being a
 * function of it anyone can invert.
 */

export const VERSION = 'v1'
export const SALT_BYTES = 16
export const IV_BYTES = 12
export const KEY_ID_BYTES = 8
/** AES-GCM's authentication tag, which Web Crypto appends to the ciphertext. */
const TAG_BYTES = 16
const SEGMENTS = 5

export interface Envelope {
  keyId: string
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

export function formatEnvelope(envelope: Envelope): string {
  const { keyId, salt, iv, ciphertext } = envelope
  return [VERSION, keyId, base64url(salt), base64url(iv), base64url(ciphertext)].join('.')
}

/**
 * Split and CHECK the envelope before any key is involved. A wrong structure, an
 * undecodable segment and a segment of the wrong size are the same fault, and a
 * different one from a key mismatch: the ciphertext never reaches decryption, so
 * the value is corrupt (a truncated column, or a value written by another
 * scheme) rather than locked.
 *
 * The sizes are checked rather than assumed because Web Crypto reports a 0-byte
 * IV and a ciphertext shorter than the GCM tag as `OperationError`, the same
 * exception a key mismatch raises. Left to decryption, a truncated column would
 * be reported to the operator as a rotated key and send them after a key that
 * would never have opened it.
 */
export function parseEnvelope(value: string): Envelope {
  const parts = value.split('.')
  if (parts.length !== SEGMENTS || parts[0] !== VERSION) {
    throw corrupt(`unexpected structure (${parts.length} segments)`)
  }
  const keyId = parts[1]!
  sized(keyId, 'key id', KEY_ID_BYTES)
  const ciphertext = decoded(parts[4]!, 'ciphertext')
  if (ciphertext.length < TAG_BYTES) {
    throw corrupt(`the ciphertext is ${ciphertext.length} bytes, shorter than the tag alone`)
  }
  return {
    keyId,
    salt: sized(parts[2]!, 'salt', SALT_BYTES),
    iv: sized(parts[3]!, 'iv', IV_BYTES),
    ciphertext,
  }
}

function decoded(segment: string, name: string): Uint8Array<ArrayBuffer> {
  try {
    return base64urlToBytes(segment)
  } catch (err) {
    throw corrupt(`the ${name} is not base64url`, err)
  }
}

function sized(segment: string, name: string, bytes: number): Uint8Array<ArrayBuffer> {
  const value = decoded(segment, name)
  if (value.length !== bytes) throw corrupt(`the ${name} is ${value.length} bytes, not ${bytes}`)
  return value
}

function corrupt(reason: string, cause?: unknown): SecretDecryptError {
  return new SecretDecryptError(
    'corrupt',
    'A stored token is not a valid encryption envelope: it is truncated, corrupted, or was ' +
      `written by a different encryption scheme (${reason}). Enter the token again to re-seal it.`,
    { cause },
  )
}
