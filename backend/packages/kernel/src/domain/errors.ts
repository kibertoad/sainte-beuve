/**
 * Domain errors. A handler maps these to a status code in one place
 * (`handleError` in @sainte-beuve/server), so a service never reaches for an HTTP
 * concept and every facade answers the same way for the same fault.
 */
export type DomainErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'unauthenticated'
  | 'forbidden'
  | 'unavailable'
  | 'upstream_failed'
  | 'payload_too_large'
  | 'misconfigured'

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details: unknown

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('not_found', message, details)
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('validation', message, details)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, details)
  }
}

/**
 * Nobody proved who they are, and this deployment insists.
 *
 * Separate from `ForbiddenError`, because the two send a caller to different
 * places: this one says sign in (or present a key), and that one says you are
 * signed in and it is still not yours. Collapsing them would have a screen
 * offering a sign-in button to somebody already signed in.
 */
export class UnauthenticatedError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('unauthenticated', message, details)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('forbidden', message, details)
  }
}

/** A capability the deployment did not wire, e.g. Slack with no bot token. */
/**
 * The request body is longer than this deployment will read.
 *
 * Its own code rather than a validation failure, because the two are refused at
 * different moments and an operator has to be able to tell them apart: a
 * validation error describes a body that was READ, and this one is the body that
 * was not. See the body limits in `createApp`.
 */
export class PayloadTooLargeError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('payload_too_large', message, details)
  }
}

export class UnavailableError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('unavailable', message, details)
  }
}

/**
 * The deployment's own configuration is wrong, and nothing it could serve would
 * be right.
 *
 * A DOMAIN error rather than a bare `Error` because of where it is thrown from.
 * Node reads its configuration once at boot, so a throw there is a process that
 * refuses to start with the reason on stderr. A Worker has no boot with its
 * bindings in hand — `env` arrives with the request — so the same throw comes
 * out of the container factory on every request, and as an anonymous `Error` it
 * became an opaque 500 with the reason only in `wrangler tail`. As this, it is a
 * 503 carrying the operator's message in the ordinary envelope, so `curl` says
 * what stderr says on Node and the two runtimes stop diverging on exactly the
 * property the refusal exists to enforce.
 *
 * Its own code rather than `unavailable`, which means a capability this
 * deployment chose not to wire: that is a deployment working as configured, and
 * this is one that cannot work at all.
 */
export class ConfigurationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('misconfigured', message, details)
  }
}

/** A configured dependency answered, and the answer was a failure (cat-factory, GitHub, Slack). */
export class UpstreamFailedError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('upstream_failed', message, details)
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError
}

/** Narrow an optional lookup to its value, or fail with a message naming what was missing. */
export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new NotFoundError(message)
  return value
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
