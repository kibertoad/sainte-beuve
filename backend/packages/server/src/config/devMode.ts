import { ConfigurationError } from '@sainte-beuve/kernel'
import { type AuthModeInput, publicOrigin } from './authMode.js'

const VALUES = 'DEV_MODE is `true` or `false`'

const PUBLIC_DEV =
  'DEV_MODE=true lets any caller act as any person in the directory, admins included. That is ' +
  'for testing multi-user flows on a laptop and it is not safe on a deployment reachable at %s. ' +
  'Clear DEV_MODE, or drop the public origin.'

/**
 * Whether persona switching is on, read the same way by every runtime.
 *
 * Unset and blank are off. A value that is neither `true` nor `false` is refused
 * rather than read as off, and `true` beside a public origin is refused for the
 * reason `authModeFrom` refuses `open` there.
 */
export function devModeFrom(input: AuthModeInput): boolean {
  const typed = (input.value ?? '').trim().toLowerCase()
  if (typed === '' || typed === 'false') return false
  if (typed !== 'true') {
    throw new ConfigurationError(`${VALUES}, and this deployment was given "${input.value ?? ''}".`)
  }
  const reachable = publicOrigin(input)
  if (reachable !== null) throw new ConfigurationError(PUBLIC_DEV.replace('%s', reachable))
  return true
}
