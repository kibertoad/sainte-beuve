/**
 * Authenticated encryption of credentials at rest.
 *
 * The port takes strings and returns strings: the algorithm, the key derivation
 * and the envelope format are entirely the adapter's business, so a scheme change
 * is one class and no caller. Nothing above this line ever holds a key, and the
 * only thing that reaches persistence is the sealed envelope.
 *
 * OPTIONAL on the container, like every other capability: a deployment that has
 * configured no encryption key cannot store a credential, and the route that
 * needs one answers 503 naming the configuration that is missing rather than
 * writing a token somewhere in the clear.
 */

/**
 * What a cipher can say about an envelope WITHOUT opening it, which is what a
 * status screen asks: it wants to know whether the deployment could still use a
 * stored credential, and it has no business holding one to find out.
 *
 * `key_mismatch` and `corrupt` are separate because they are separate
 * instructions for an operator: the first says restore the previous key or enter
 * the credential again, the second says the stored value is not an envelope this
 * scheme wrote and no key will open it.
 */
export type SecretEnvelopeState = 'readable' | 'key_mismatch' | 'corrupt'

export type SecretDecryptFailure = Exclude<SecretEnvelopeState, 'readable'>

/**
 * Why an envelope could not be opened, carried as a FIELD rather than left for a
 * caller to recognise in a message. A screen that reports "sealed under a
 * different key" for a truncated column sends the operator after a key that was
 * never rotated.
 */
export class SecretDecryptError extends Error {
  readonly failure: SecretDecryptFailure

  constructor(failure: SecretDecryptFailure, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
    this.failure = failure
  }
}

export function isSecretDecryptError(err: unknown): err is SecretDecryptError {
  return err instanceof SecretDecryptError
}

export interface SecretCipher {
  /**
   * Seal plaintext into an opaque, self-describing envelope.
   *
   * `context` is BOUND to the envelope: it names what the value is for (an
   * integration id, say) and opening the envelope under a different context
   * fails. That is what stops a sealed value from being moved between rows, by a
   * migration or by anyone with write access to the store, and being handed to
   * the wrong system as a valid credential.
   */
  encrypt(plaintext: string, context: string): Promise<string>
  /**
   * Open an envelope produced by {@link SecretCipher.encrypt} under the same
   * context. THROWS {@link SecretDecryptError} when the envelope is corrupt, was
   * sealed under a different key, or was sealed for a different context.
   */
  decrypt(envelope: string, context: string): Promise<string>
  /**
   * Whether this cipher's key is the one the envelope was sealed under, decided
   * from the envelope's key id rather than by decrypting. Answers about the KEY,
   * not about the context binding: a `readable` envelope opened under the wrong
   * context still fails, and that is the point of the binding.
   */
  inspect(envelope: string): Promise<SecretEnvelopeState>
}
