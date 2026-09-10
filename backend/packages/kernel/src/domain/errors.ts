/**
 * Domain errors. A handler maps these to a status code in one place
 * (`handleError` in @sainte-beuve/server), so a service never reaches for an HTTP
 * concept and every facade answers the same way for the same fault.
 */
export type DomainErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'unavailable'
  | 'upstream_failed'

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

export class ForbiddenError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('forbidden', message, details)
  }
}

/** A capability the deployment did not wire, e.g. Slack with no bot token. */
export class UnavailableError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('unavailable', message, details)
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
