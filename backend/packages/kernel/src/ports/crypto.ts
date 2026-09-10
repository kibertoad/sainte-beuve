/**
 * Authenticated encryption of credentials at rest.
 *
 * The port takes a string and returns a string: the algorithm, the key
 * derivation and the envelope format are entirely the adapter's business, so a
 * scheme change is one class and no caller. Nothing above this line ever holds a
 * key, and the only thing that reaches persistence is the sealed envelope.
 *
 * OPTIONAL on the container, like every other capability: a deployment that has
 * configured no encryption key cannot store a credential, and the route that
 * needs one answers 503 naming the configuration that is missing rather than
 * writing a token somewhere in the clear.
 */
export interface SecretCipher {
  /** Seal plaintext into an opaque, self-describing envelope. */
  encrypt(plaintext: string): Promise<string>
  /**
   * Open an envelope produced by {@link SecretCipher.encrypt}. THROWS when the
   * envelope is malformed or when it was sealed under a different key, which is
   * what a caller reads as "stored, and no longer readable".
   */
  decrypt(envelope: string): Promise<string>
}
