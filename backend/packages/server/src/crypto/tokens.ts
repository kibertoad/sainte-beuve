import { base64url } from '@sainte-beuve/kernel'

/**
 * The two bearer credentials this deployment issues itself: a session value and
 * an API key.
 *
 * Both are made the same way and stored the same way, which is the point of one
 * module rather than two: a mint that produced fewer bytes for one of them, or a
 * digest spelled differently on the way in than on the way out, is a difference
 * nothing would notice until it mattered.
 *
 * On Web Crypto and `crypto.getRandomValues`, like everything else in this
 * directory, so the same code runs inside workerd and under Node.
 */

/**
 * 32 bytes, which is the number that makes the rest of the scheme work. At 256
 * bits there is nothing to guess and nothing to look up, which is why the store
 * can hold an UNKEYED digest of these and still be useless to whoever reads it
 * (see `StoredSession` in @sainte-beuve/kernel).
 */
const TOKEN_BYTES = 32

/** How much of a key is shown afterwards, so an operator can match a row to a secret store. */
const HINT_LENGTH = 4

/**
 * The prefixes. They are not decoration: a secret scanner and a person reading a
 * CI log both need to recognise one of these on sight, and the two kinds have to
 * be distinguishable so a session value pasted into an `Authorization` header is
 * not looked for in the wrong table.
 */
export const SESSION_TOKEN_PREFIX = 'sbs_'
export const API_KEY_PREFIX = 'sbk_'

/** A fresh bearer value with the given prefix. */
export function mintToken(prefix: string): string {
  return `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))}`
}

/**
 * What the store holds instead of the token: SHA-256, base64url.
 *
 * Unkeyed on purpose. The alternative is an HMAC under the deployment's master
 * key, which buys nothing against a value that cannot be guessed and costs
 * something real: every session and every API key would stop resolving the
 * moment the key was rotated, and a rotation is an operator's routine act rather
 * than an incident.
 */
export async function digestOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64url(new Uint8Array(digest))
}

/** The tail of a token, which is all that is kept of it in readable form. */
export function hintOfToken(token: string): string {
  return token.slice(-HINT_LENGTH)
}

/**
 * A value with nothing to guess and no prefix to recognise, for pairing a signed
 * round-trip state with the browser that started it. See `RoundTripState`.
 *
 * The same 32 bytes as the credentials above, from the same mint, because the
 * property it needs is the property they need: an attacker who could predict one
 * could complete somebody else's flow.
 */
export function mintNonce(): string {
  return mintToken('')
}
