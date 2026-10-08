import { ConfigurationError } from '@sainte-beuve/kernel'
import { API_KEY_PREFIX } from '../crypto/tokens.js'

/**
 * The shortest `AUTH_API_KEY` this deployment will hold.
 *
 * 32 characters is 128 bits written as hex and more than that as base64, which
 * is what `openssl rand` gives anybody who asks it. Length is not entropy, and a
 * long dictionary phrase passes. What this refuses is the value nobody
 * generated (`changeme`, a project name, a word), which is the one that gets
 * guessed.
 */
const MIN_ENVIRONMENT_API_KEY_LENGTH = 32

const TOO_SHORT =
  'AUTH_API_KEY is an ADMIN credential of the default org and is what every guessed bearer is ' +
  `compared against, so it has to be at least ${MIN_ENVIRONMENT_API_KEY_LENGTH} characters, and this ` +
  'deployment was given %d. Generate one with `openssl rand -hex 32`, or clear the variable.'

const MINTED_PREFIX =
  `AUTH_API_KEY starts with \`${API_KEY_PREFIX}\`, the prefix of the keys minted on the ` +
  'Configuration screen, which are looked up in the store and never compared against this ' +
  'variable. A minted key already works as itself; give the variable a value of its own ' +
  '(`openssl rand -hex 32`), or clear it.'

/**
 * Which `AUTH_API_KEY` a deployment holds, read the same way by every runtime.
 *
 * Blank is absent, as everywhere else in the environment: `.env.example` ships
 * every name with no value. A short value is a `ConfigurationError` rather than
 * a warning on `/health`, for the reason `authModeFrom` gives: Node refuses to
 * start, a Worker answers every request with the sentence, and in neither case
 * does a guessable admin credential serve a single request first.
 *
 * A value with the minted prefix is refused the same way: that prefix sends a
 * bearer to the store (see `isMintedKey`), so such a key would be configured
 * and unreachable.
 */
export function environmentApiKeyFrom(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null
  if (value.startsWith(API_KEY_PREFIX)) throw new ConfigurationError(MINTED_PREFIX)
  // Measured as typed, untrimmed: the comparison is against the bytes as
  // given, and padding is not entropy either.
  const length = [...value].length
  if (length < MIN_ENVIRONMENT_API_KEY_LENGTH) {
    throw new ConfigurationError(TOO_SHORT.replace('%d', String(length)))
  }
  return value
}
