import {
  getErrorMessage,
  isSecretDecryptError,
  type Logger,
  type SecretCipher,
  SecretDecryptError,
  type SecretEnvelopeState,
} from '@sainte-beuve/kernel'
import { base64url, base64urlToBytes } from './encoding.js'
import { formatEnvelope, IV_BYTES, KEY_ID_BYTES, parseEnvelope, SALT_BYTES } from './envelope.js'

/**
 * The `SecretCipher` every facade wires: AES-256-GCM over Web Crypto, which
 * workerd and Node both expose as a global. Nothing here imports `node:crypto`,
 * so the Worker bundle keeps loading.
 *
 * One master key comes from the deployment's configuration and is imported once
 * for HKDF; every record then derives its own AES key from a random salt and is
 * sealed under a random IV, so two records sealed from the same token share no
 * key material and neither reveals that they hold the same value. The record's
 * CONTEXT (the integration id) is bound as additional authenticated data, so a
 * sealed value carried from one row to another stops opening: an envelope is a
 * credential for one integration and for nothing else.
 *
 * The envelope also carries an id for the key that sealed it (see envelope.ts),
 * which is what lets a status read answer "this deployment cannot open that"
 * from the envelope alone, deriving no key and holding no credential.
 *
 * An instance is worth CACHING per master key: the HKDF import and the key id
 * are memoised on it, so a facade that builds one per request pays for both
 * again on every request.
 */

const MIN_KEY_BYTES = 32
/** HKDF domain separation, so this key derives nothing usable for another purpose. */
const INFO = 'sainte-beuve:integration-tokens'
/** A second HKDF label, so the key id cannot collide with a record's own key. */
const KEY_ID_INFO = 'sainte-beuve:integration-tokens:key-id'
/** HKDF reads a zero-length salt as all-zeros, which is what a DETERMINISTIC id needs. */
const NO_SALT = new Uint8Array(0)

export interface WebCryptoSecretCipherOptions {
  /** The deployment's master key, base64 (32 bytes or more, decoded). */
  masterKeyBase64: string
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>
}

export class WebCryptoSecretCipher implements SecretCipher {
  // ArrayBuffer-backed rather than the wider ArrayBufferLike, so the bytes
  // satisfy Web Crypto's `BufferSource` parameters under the strict lib.
  private readonly masterKey: Uint8Array<ArrayBuffer>
  private readonly info: Uint8Array<ArrayBuffer>
  private baseKeyPromise?: Promise<CryptoKey>
  private keyIdPromise?: Promise<string>

  constructor({ masterKeyBase64 }: WebCryptoSecretCipherOptions) {
    this.masterKey = decodeKey(masterKeyBase64)
    this.info = utf8(INFO)
  }

  async encrypt(plaintext: string, context: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(context) },
      await this.deriveKey(salt),
      utf8(plaintext),
    )
    const keyId = await this.keyId()
    return formatEnvelope({ keyId, salt, iv, ciphertext: new Uint8Array(sealed) })
  }

  async decrypt(envelope: string, context: string): Promise<string> {
    const { keyId, salt, iv, ciphertext } = parseEnvelope(envelope)
    if (keyId !== (await this.keyId())) throw rotatedKey()
    let plain: ArrayBuffer
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: utf8(context) },
        await this.deriveKey(salt),
        ciphertext,
      )
    } catch (err) {
      // The key that sealed this IS this one, and AES-GCM still refused: the
      // envelope was sealed for a different context, or its stored bytes were
      // altered. Web Crypto's own failure is the opaque "operation failed for an
      // operation-specific reason" DOMException, so say what an operator can act
      // on and keep the original as `cause`.
      throw new SecretDecryptError(
        'corrupt',
        'A stored token failed authentication: it was sealed for a different integration, or ' +
          'its stored bytes were altered. Enter the token again to re-seal it.',
        { cause: err },
      )
    }
    return new TextDecoder().decode(plain)
  }

  async inspect(envelope: string): Promise<SecretEnvelopeState> {
    try {
      return parseEnvelope(envelope).keyId === (await this.keyId()) ? 'readable' : 'key_mismatch'
    } catch (err) {
      if (isSecretDecryptError(err)) return err.failure
      throw err
    }
  }

  private baseKey(): Promise<CryptoKey> {
    this.baseKeyPromise ??= crypto.subtle.importKey('raw', this.masterKey, 'HKDF', false, [
      'deriveKey',
      'deriveBits',
    ])
    return this.baseKeyPromise
  }

  private keyId(): Promise<string> {
    this.keyIdPromise ??= this.deriveKeyId()
    return this.keyIdPromise
  }

  private async deriveKeyId(): Promise<string> {
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: NO_SALT, info: utf8(KEY_ID_INFO) },
      await this.baseKey(),
      KEY_ID_BYTES * 8,
    )
    return base64url(new Uint8Array(bits))
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

function rotatedKey(): SecretDecryptError {
  return new SecretDecryptError(
    'key_mismatch',
    'A stored token could not be decrypted: it was sealed under a different encryption key, ' +
      'most likely because SETTINGS_ENCRYPTION_KEY was rotated. Restore the previous key, or ' +
      'enter the token again to seal it under the current one.',
  )
}

/**
 * The cipher a facade's configuration asks for, or the reason there is none.
 *
 * Shared by every facade so the three answer a missing or mistyped key
 * identically, and the reason is CARRIED rather than only logged: "no key is
 * configured" and "the key you configured was refused" are different
 * instructions, and an operator told the first when the second is true re-sets
 * the same bad value and loops.
 *
 * A bad key must not take the deployment down: storing a credential is one
 * optional capability among several, and a board that refuses to serve because
 * an encryption key was mistyped is a worse outcome than a Configuration screen
 * reporting itself unavailable. `/health` says `secrets: false` either way.
 */
export interface SecretCipherWiring {
  cipher: SecretCipher | null
  /** Null when no key was configured at all, which is not a fault to report. */
  rejectedReason: string | null
}

export function secretCipherFrom(options: {
  masterKeyBase64: string | null | undefined
  logger: Logger
}): SecretCipherWiring {
  const { masterKeyBase64, logger } = options
  if (!masterKeyBase64) return { cipher: null, rejectedReason: null }
  try {
    return { cipher: new WebCryptoSecretCipher({ masterKeyBase64 }), rejectedReason: null }
  } catch (err) {
    logger.error(
      { err },
      'SETTINGS_ENCRYPTION_KEY is set but unusable; storing integration tokens stays off',
    )
    return { cipher: null, rejectedReason: getErrorMessage(err) }
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
