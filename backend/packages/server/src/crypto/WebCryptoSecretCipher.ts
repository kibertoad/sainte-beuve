import type { Logger, SecretCipher } from '@sainte-beuve/kernel'
import { base64url, base64urlToBytes } from './encoding.js'

/**
 * The `SecretCipher` every facade wires: AES-256-GCM over Web Crypto, which
 * workerd and Node both expose as a global. Nothing here imports `node:crypto`,
 * so the Worker bundle keeps loading.
 *
 * One master key comes from the deployment's configuration and is imported once
 * for HKDF; every record then derives its own AES key from a random salt and is
 * sealed under a random IV, so two records sealed from the same token share no
 * key material and neither reveals that they hold the same value.
 *
 *   envelope = "v1." + base64url(salt) + "." + base64url(iv) + "." + base64url(ciphertext|tag)
 *
 * The version tag is what makes a later scheme change readable: an envelope
 * written by a different version is refused as corrupt instead of being fed to
 * the wrong parser.
 */

const VERSION = 'v1'
const SALT_BYTES = 16
const IV_BYTES = 12
const MIN_KEY_BYTES = 32
/** HKDF domain separation, so this key derives nothing usable for another purpose. */
const INFO = 'sainte-beuve:integration-tokens'

export interface WebCryptoSecretCipherOptions {
  /** The deployment's master key, base64 (32 bytes or more, decoded). */
  masterKeyBase64: string
}

export class WebCryptoSecretCipher implements SecretCipher {
  // ArrayBuffer-backed rather than the wider ArrayBufferLike, so the bytes
  // satisfy Web Crypto's `BufferSource` parameters under the strict lib.
  private readonly masterKey: Uint8Array<ArrayBuffer>
  private readonly info: Uint8Array<ArrayBuffer>
  private baseKeyPromise?: Promise<CryptoKey>

  constructor({ masterKeyBase64 }: WebCryptoSecretCipherOptions) {
    this.masterKey = decodeKey(masterKeyBase64)
    this.info = new TextEncoder().encode(INFO) as Uint8Array<ArrayBuffer>
  }

  async encrypt(plaintext: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.deriveKey(salt),
      new TextEncoder().encode(plaintext),
    )
    return [VERSION, base64url(salt), base64url(iv), base64url(new Uint8Array(sealed))].join('.')
  }

  async decrypt(envelope: string): Promise<string> {
    const { salt, iv, ciphertext } = parseEnvelope(envelope)
    let plain: ArrayBuffer
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await this.deriveKey(salt),
        ciphertext,
      )
    } catch (err) {
      // AES-GCM authentication failed, which in practice means the encryption
      // key is not the one this envelope was sealed under: it was rotated or
      // regenerated, and everything sealed under the old one is unrecoverable.
      // Web Crypto's own failure is the opaque "operation failed for an
      // operation-specific reason" DOMException, so say what an operator can act
      // on and keep the original as `cause`.
      throw new Error(
        'A stored token could not be decrypted: the encryption key does not match the one it ' +
          'was sealed under, most likely because the key was rotated. Restore the previous key, ' +
          'or enter the token again to seal it under the current one.',
        { cause: err },
      )
    }
    return new TextDecoder().decode(plain)
  }

  private baseKey(): Promise<CryptoKey> {
    this.baseKeyPromise ??= crypto.subtle.importKey('raw', this.masterKey, 'HKDF', false, [
      'deriveKey',
    ])
    return this.baseKeyPromise
  }

  private async deriveKey(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: this.info },
      await this.baseKey(),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }
}

/**
 * Wire the cipher a facade's configuration asks for, or leave the capability off
 * with the reason in the log. Shared by every facade so the three answer a
 * missing or mistyped key identically.
 *
 * A bad key must not take the deployment down: storing a credential is one
 * optional capability among several, and a board that refuses to serve because
 * an encryption key was mistyped is a worse outcome than a Configuration screen
 * reporting itself unavailable. `/health` says `secrets: false` either way.
 */
export function secretCipherFrom(options: {
  masterKeyBase64: string | null | undefined
  logger: Logger
}): SecretCipher | null {
  const { masterKeyBase64, logger } = options
  if (!masterKeyBase64) return null
  try {
    return new WebCryptoSecretCipher({ masterKeyBase64 })
  } catch (err) {
    logger.error(
      { err },
      'SETTINGS_ENCRYPTION_KEY is set but unusable; storing integration tokens stays off',
    )
    return null
  }
}

/**
 * Refuse a key that is absent, unreadable or too short AT CONSTRUCTION. A cipher
 * that only fails on the first credential someone tries to store would report a
 * configuration mistake as a runtime fault, hours after the deploy that made it.
 */
function decodeKey(masterKeyBase64: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = base64urlToBytes(masterKeyBase64.trim())
  } catch (err) {
    throw new Error('the encryption key is not valid base64', { cause: err })
  }
  if (bytes.length < MIN_KEY_BYTES) {
    throw new Error(
      `the encryption key must decode to at least ${MIN_KEY_BYTES} bytes; generate one with \`openssl rand -base64 32\``,
    )
  }
  return bytes
}

interface ParsedEnvelope {
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

/**
 * Split the envelope before any key is involved. A wrong structure and an
 * undecodable segment are the same fault, and a different one from a key
 * mismatch: the ciphertext never reaches decryption, so the value is corrupt
 * (a truncated column, or a value written by another scheme) rather than
 * locked.
 */
function parseEnvelope(envelope: string): ParsedEnvelope {
  try {
    const parts = envelope.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error(`unexpected envelope structure (${parts.length} segments)`)
    }
    return {
      salt: base64urlToBytes(parts[1]!),
      iv: base64urlToBytes(parts[2]!),
      ciphertext: base64urlToBytes(parts[3]!),
    }
  } catch (err) {
    throw new Error(
      'A stored token is not a valid encryption envelope: it is truncated, corrupted, or was ' +
        'written by a different encryption scheme. Enter the token again to re-seal it.',
      { cause: err },
    )
  }
}
