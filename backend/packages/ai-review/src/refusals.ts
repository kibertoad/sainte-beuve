import {
  CatFactoryConflictError,
  CatFactoryCredentialRequiredError,
  CatFactoryForbiddenError,
  CatFactoryNotFoundError,
  CatFactoryRateLimitedError,
  CatFactoryUnauthorizedError,
  CatFactoryValidationError,
} from '@cat-factory/sdk'
import {
  ConflictError,
  type DomainError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
  UpstreamFailedError,
  ValidationError,
  getErrorMessage,
} from '@sainte-beuve/kernel'

/**
 * A cat-factory refusal, as the fault sainte-beuve answers with.
 *
 * Every call this package makes is translated here, FILING included. The refusal
 * a deployment meets first is the one filing throws: a `review` task parks on its
 * findings, so cat-factory checks that the calling key could answer a decision
 * before it starts the run, and a key carrying only `write` is turned away there
 * rather than at the first curation verb. Reporting that as an upstream fault
 * sends an operator to read somebody else's logs about their own key.
 *
 * Passed THROUGH rather than collapsed to one upstream failure, because for this
 * loop the difference is what the person clicking the button has to do next, and
 * every one of these is a refusal they can act on:
 *
 * - 409: the review has moved on. Somebody else settled it, or a resume was asked
 *   of a review that is not in progress. Re-reading the run is the fix; retrying
 *   the same call gets the same answer for ever.
 * - 404: the run or the finding is not there. A dismissed finding is gone from the
 *   list, so a stale screen clicking it again lands here.
 * - 403: the key's scope is too low. Filing a review needs `decide` for the same
 *   reason every verb in this loop does, and the message names it.
 * - 401: the key itself is no longer good, revoked or rotated while this
 *   deployment went on holding it. A Configuration screen away, and nothing to do
 *   with cat-factory being healthy.
 * - 429: cat-factory is at capacity, either a rate limit or a full cap
 *   (`too_many_active_runs`). The one answer here that IS to make the same call
 *   again, which a 502 would tell nobody.
 * - 428: cat-factory needs a credential of its OWN that nobody connected on that
 *   side, so it is unavailable for this work rather than faulty.
 * - 400: cat-factory's own rule refused the request (an empty selection for a
 *   `post`, say).
 *
 * Anything else is 502: cat-factory faulted, and an operator reading our logs
 * should be sent upstream rather than into this codebase.
 */
export function refusalFor(err: unknown, what: string): DomainError {
  const detail = `${what}: ${getErrorMessage(err)}`
  if (err instanceof CatFactoryConflictError) {
    return new ConflictError(`cat-factory would not ${detail}`)
  }
  if (err instanceof CatFactoryNotFoundError) {
    return new NotFoundError(`cat-factory has nothing to ${detail}`)
  }
  if (err instanceof CatFactoryForbiddenError) {
    return new ForbiddenError(
      `cat-factory refused to ${detail}. A review is filed and driven with an API key carrying the \`decide\` scope`,
    )
  }
  if (err instanceof CatFactoryUnauthorizedError) {
    return new ForbiddenError(
      `cat-factory rejected this deployment's API key when asked to ${detail}. The key has been revoked or rotated; a current one can be entered on the Configuration screen`,
    )
  }
  if (err instanceof CatFactoryRateLimitedError) {
    return new UnavailableError(
      `cat-factory is at capacity and could not ${detail}. The same call is worth making again shortly`,
    )
  }
  if (err instanceof CatFactoryCredentialRequiredError) {
    return new UnavailableError(
      `cat-factory cannot ${detail} until the credential it names is connected on the cat-factory side`,
    )
  }
  if (err instanceof CatFactoryValidationError) {
    return new ValidationError(`cat-factory refused to ${detail}`)
  }
  return new UpstreamFailedError(`cat-factory could not ${detail}`)
}
