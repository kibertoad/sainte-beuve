import { ConfigurationError } from '@sainte-beuve/kernel'

/**
 * The shortest `AUTH_API_KEY` this deployment will hold.
 *
 * 32 characters is 128 bits written as hex and more than that as base64, which
 * is what `openssl rand` gives anybody who asks it. Length is not entropy, and a
 * long dictionary phrase passes; what this refuses is the value nobody generated
 * — `changeme`, a project name, a word — which is the one that gets guessed.
 */
const MIN_ENVIRONMENT_API_KEY_LENGTH = 32

const TOO_SHORT =
  'AUTH_API_KEY is an ADMIN credential of the default org and is compared on every bearer ' +
  `attempt, so it has to be at least ${MIN_ENVIRONMENT_API_KEY_LENGTH} characters, and this ` +
  'deployment was given %d. Generate one with `openssl rand -hex 32`, or clear the variable.'

/**
 * Which `AUTH_API_KEY` a deployment holds, read the same way by every runtime.
 *
 * Blank is absent, as everywhere else in the environment: `.env.example` ships
 * every name with no value. A short value is a `ConfigurationError` rather than
 * a warning on `/health`, for the reason `authModeFrom` gives: Node refuses to
 * start, a Worker answers every request with the sentence, and in neither case
 * does a guessable admin credential serve a single request first.
 */
export function environmentApiKeyFrom(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null
  // Measured as typed, untrimmed: the comparison is against the bytes as
  // given, and padding is not entropy either.
  const length = [...value].length
  if (length < MIN_ENVIRONMENT_API_KEY_LENGTH) {
    throw new ConfigurationError(TOO_SHORT.replace('%d', String(length)))
  }
  return value
}
