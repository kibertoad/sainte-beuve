import type { RoundTripState } from '@sainte-beuve/kernel'
import { timingSafeEqual, ValidationError } from '@sainte-beuve/kernel'

/**
 * The two checks a callback makes on the value it was handed back, once the
 * signature has already been verified.
 *
 * Beside `ConnectionsService` rather than inside it because neither touches the
 * container: both are functions of what came back, and a suite can walk them
 * without a deployment around them. See `RoundTripState`.
 */

/**
 * A validation error, not a forbidden one: the overwhelmingly common cause is an
 * operator finishing a flow they started an hour ago, and the message has to say
 * "start again" rather than accuse them of anything.
 */
export function notOurState(): ValidationError {
  return new ValidationError(
    'This callback did not carry a state this deployment recently issued. Start the ' +
      'connection again from the Configuration screen.',
  )
}

/**
 * The last check, and the one a signature cannot make: that the browser
 * finishing this round trip is the browser that started it.
 *
 * Anybody can start a flow here and be handed a state this deployment really
 * signed. Without this, handing the finished callback URL to somebody else signs
 * THEM in on the attacker's account — a login CSRF, and on the connect flow it
 * would store the attacker's credential as the deployment's. The nonce is in the
 * signed state and in an `HttpOnly` cookie set on the same answer, so producing
 * a matching pair means holding both.
 *
 * Constant-time, like every other comparison against a value somebody supplied.
 */
export function startedByThisBrowser(claims: RoundTripState, nonce: string | null): RoundTripState {
  const encoder = new TextEncoder()
  if (nonce === null || !timingSafeEqual(encoder.encode(claims.nonce), encoder.encode(nonce))) {
    throw new ValidationError(
      'This callback was started in a different browser, or the round trip took long enough ' +
        'that what started it has expired. Start the connection again from this browser, and ' +
        'check that it is not blocking cookies for this deployment.',
    )
  }
  return claims
}
