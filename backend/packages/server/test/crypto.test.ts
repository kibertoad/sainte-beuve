import { describe, expect, it } from 'vitest'
import { WebCryptoSecretCipher } from '../src/crypto/WebCryptoSecretCipher.js'

// The at-rest encryption behind the Configuration screen. Web Crypto only, so
// these assertions hold identically on workerd and on Node.

const KEY = btoa('0123456789abcdef0123456789abcdef')
const OTHER_KEY = btoa('fedcba9876543210fedcba9876543210')
const TOKEN = 'cf_live_9f8e7d6c5b4a'

describe('WebCryptoSecretCipher', () => {
  const cipher = new WebCryptoSecretCipher({ masterKeyBase64: KEY })

  it('round-trips a token without carrying it in the envelope', async () => {
    const sealed = await cipher.encrypt(TOKEN)
    expect(sealed).toMatch(/^v1\./)
    expect(sealed).not.toContain(TOKEN)
    expect(await cipher.decrypt(sealed)).toBe(TOKEN)
  })

  it('seals the same token differently every time', async () => {
    const first = await cipher.encrypt(TOKEN)
    const second = await cipher.encrypt(TOKEN)
    expect(first).not.toBe(second)
    expect(await cipher.decrypt(second)).toBe(TOKEN)
  })

  it('refuses an envelope sealed under a different key, and says which fault it is', async () => {
    const sealed = await new WebCryptoSecretCipher({ masterKeyBase64: OTHER_KEY }).encrypt(TOKEN)
    const err = (await cipher.decrypt(sealed).catch((e: unknown) => e)) as Error
    // The actionable message, not Web Crypto's opaque DOMException (kept as `cause`).
    expect(err.message).toMatch(/encryption key does not match/i)
    expect(err.cause).toBeDefined()
  })

  it('refuses a corrupt envelope before it reaches a key', async () => {
    await expect(cipher.decrypt('not-an-envelope')).rejects.toThrow(/not a valid encryption/i)
    // Right shape, undecodable body: still a corruption, not a key mismatch.
    await expect(cipher.decrypt('v1.@@@.@@@.@@@')).rejects.toThrow(/not a valid encryption/i)
  })

  it('refuses a key too short to be one, at construction', () => {
    expect(() => new WebCryptoSecretCipher({ masterKeyBase64: btoa('too-short') })).toThrow(
      /at least 32 bytes/,
    )
  })
})
