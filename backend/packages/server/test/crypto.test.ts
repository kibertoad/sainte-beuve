import { isSecretDecryptError, type SecretDecryptError } from '@sainte-beuve/kernel'
import { describe, expect, it } from 'vitest'
import { WebCryptoSecretCipher } from '../src/crypto/WebCryptoSecretCipher.js'

// The at-rest encryption behind the Configuration screen. Web Crypto only, so
// these assertions hold identically on workerd and on Node.

const KEY = btoa('0123456789abcdef0123456789abcdef')
const OTHER_KEY = btoa('fedcba9876543210fedcba9876543210')
const TOKEN = 'cf_live_9f8e7d6c5b4a'
const CONTEXT = 'cat-factory'

/** The typed failure, so a case can assert WHICH fault it is and not a message. */
async function refusal(opening: Promise<unknown>): Promise<SecretDecryptError> {
  const err: unknown = await opening.catch((e: unknown) => e)
  if (!isSecretDecryptError(err))
    throw new Error(`expected a SecretDecryptError, got ${String(err)}`)
  return err
}

describe('WebCryptoSecretCipher', () => {
  const cipher = new WebCryptoSecretCipher({ masterKeyBase64: KEY })

  it('round-trips a token without carrying it in the envelope', async () => {
    const sealed = await cipher.encrypt(TOKEN, CONTEXT)
    expect(sealed).toMatch(/^v1\./)
    expect(sealed).not.toContain(TOKEN)
    expect(await cipher.decrypt(sealed, CONTEXT)).toBe(TOKEN)
  })

  it('seals the same token differently every time', async () => {
    const first = await cipher.encrypt(TOKEN, CONTEXT)
    const second = await cipher.encrypt(TOKEN, CONTEXT)
    expect(first).not.toBe(second)
    expect(await cipher.decrypt(second, CONTEXT)).toBe(TOKEN)
  })

  it('refuses an envelope sealed under a different key, and says which fault it is', async () => {
    const sealed = await new WebCryptoSecretCipher({ masterKeyBase64: OTHER_KEY }).encrypt(
      TOKEN,
      CONTEXT,
    )
    const err = await refusal(cipher.decrypt(sealed, CONTEXT))
    expect(err.failure).toBe('key_mismatch')
    expect(err.message).toMatch(/rotated/i)
  })

  it('refuses an envelope sealed for another integration', async () => {
    // What a value copied between rows looks like: the deployment's own key, and
    // a credential the other integration would otherwise authenticate with.
    const sealed = await cipher.encrypt(TOKEN, 'cat-factory')
    expect((await refusal(cipher.decrypt(sealed, 'other-factory'))).failure).toBe('corrupt')
  })

  it('refuses a corrupt envelope before it reaches a key', async () => {
    for (const value of ['not-an-envelope', 'v2.a.b.c.d', 'v1.@@@.@@@.@@@.@@@', 'v1....']) {
      expect((await refusal(cipher.decrypt(value, CONTEXT))).failure).toBe('corrupt')
      expect(await cipher.inspect(value)).toBe('corrupt')
    }
  })

  it('reads a truncated envelope as corrupt rather than as a rotated key', async () => {
    const [version, keyId, salt, iv] = (await cipher.encrypt(TOKEN, CONTEXT)).split('.')
    // The right structure and this deployment's own key id, with the body cut off:
    // left to Web Crypto, an empty iv and a ciphertext shorter than the GCM tag
    // raise the same OperationError a key mismatch does, and the operator would be
    // sent after a key that was never rotated.
    for (const truncated of [
      [version, keyId, salt, iv, ''],
      [version, keyId, '', '', ''],
    ]) {
      const err = await refusal(cipher.decrypt(truncated.join('.'), CONTEXT))
      expect(err.failure).toBe('corrupt')
    }
  })

  it('answers whether it can open an envelope without opening it', async () => {
    const mine = await cipher.encrypt(TOKEN, CONTEXT)
    const theirs = await new WebCryptoSecretCipher({ masterKeyBase64: OTHER_KEY }).encrypt(
      TOKEN,
      CONTEXT,
    )
    expect(await cipher.inspect(mine)).toBe('readable')
    expect(await cipher.inspect(theirs)).toBe('key_mismatch')
  })

  it('stamps every envelope with an id for the key that sealed it', async () => {
    const keyIdOf = (envelope: string) => envelope.split('.')[1]
    const same = new WebCryptoSecretCipher({ masterKeyBase64: KEY })
    const other = new WebCryptoSecretCipher({ masterKeyBase64: OTHER_KEY })

    // Derived from the key, so a second process reading the same store recognises
    // its own envelopes, and a rotated key is answerable without a decryption.
    expect(keyIdOf(await same.encrypt(TOKEN, CONTEXT))).toBe(
      keyIdOf(await cipher.encrypt(TOKEN, CONTEXT)),
    )
    expect(keyIdOf(await other.encrypt(TOKEN, CONTEXT))).not.toBe(
      keyIdOf(await cipher.encrypt(TOKEN, CONTEXT)),
    )
  })

  it('refuses a key too short to be one, at construction', () => {
    expect(() => new WebCryptoSecretCipher({ masterKeyBase64: btoa('too-short') })).toThrow(
      /at least 32 bytes/,
    )
  })
})
