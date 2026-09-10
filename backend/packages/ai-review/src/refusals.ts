import {
  CatFactoryConflictError,
  CatFactoryForbiddenError,
  CatFactoryNotFoundError,
  CatFactoryValidationError,
} from '@cat-factory/sdk'
import {
  ConflictError,
  type DomainError,
  ForbiddenError,
  NotFoundError,
  UpstreamFailedError,
  ValidationError,
  getErrorMessage,
} from '@sainte-beuve/kernel'

/**
 * A cat-factory refusal of a curation verb, as the fault sainte-beuve answers
 * with.
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
 * - 403: the key's scope is too low. A `write` key can file nothing here, because
 *   every verb in this loop needs `decide`, and the message names it.
 * - 400: cat-factory's own rule refused the request (an empty selection for a
 *   `post`, say).
 *
 * Anything else is 502: cat-factory faulted, and an operator reading our logs
 * should be sent upstream rather than into this codebase.
 */
export function refusalFor(err: unknown, what: string, runId: string): DomainError {
  const detail = `${what} on run ${runId}: ${getErrorMessage(err)}`
  if (err instanceof CatFactoryConflictError) {
    return new ConflictError(`cat-factory would not ${detail}`)
  }
  if (err instanceof CatFactoryNotFoundError) {
    return new NotFoundError(`cat-factory has nothing to ${detail}`)
  }
  if (err instanceof CatFactoryForbiddenError) {
    return new ForbiddenError(
      `cat-factory refused to ${detail}. Driving a review needs an API key with the \`decide\` scope`,
    )
  }
  if (err instanceof CatFactoryValidationError) {
    return new ValidationError(`cat-factory refused to ${detail}`)
  }
  return new UpstreamFailedError(`cat-factory could not ${detail}`)
}
