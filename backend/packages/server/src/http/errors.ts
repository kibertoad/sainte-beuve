import type { ErrorResponse } from '@sainte-beuve/contracts'
import { issuePath } from '@sainte-beuve/contracts'
import {
  type DomainErrorCode,
  type Logger,
  UnavailableError,
  isDomainError,
} from '@sainte-beuve/kernel'
import { SchemaValidationError } from '@toad-contracts/core'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './env.js'

/**
 * The one place a domain fault becomes a status code. A service throws a
 * `DomainError` and never touches HTTP, so every facade answers identically for the
 * same fault and adding a code is a single-line change here.
 */
const STATUS_BY_CODE: Record<DomainErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  forbidden: 403,
  unavailable: 503,
  // The dependency answered and the answer was a failure. 502, not 500: the fault
  // is upstream, and an operator reading the logs should not go looking in ours.
  upstream_failed: 502,
}

export function errorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return { error: { code, message, details } }
}

/**
 * The container is set by a middleware, so it is ABSENT exactly when building it is
 * what failed: a Worker whose bindings do not resolve, say. Reading `.logger` off
 * it unguarded would throw a TypeError out of the error handler and bury the
 * original fault under an opaque 500, so fall back to the console and keep the
 * cause in the log.
 */
function loggerFor(c: Context<AppEnv>): Logger {
  return c.get('container')?.logger ?? console
}

export function handleError(err: unknown, c: Context<AppEnv>): Response {
  // A request that does not match its contract. `buildHonoRoute`'s validator throws
  // this rather than answering, so that the shape of the refusal is decided here
  // with every other error and not once per route.
  if (err instanceof SchemaValidationError) {
    return c.json(
      errorBody(
        'validation',
        err.message,
        err.issues.map((issue) => ({ path: issuePath(issue), message: issue.message })),
      ),
      400,
    )
  }
  if (isDomainError(err)) {
    const status = STATUS_BY_CODE[err.code]
    if (status >= 500) loggerFor(c).error({ err, code: err.code }, err.message)
    return c.json(errorBody(err.code, err.message, err.details), status)
  }
  loggerFor(c).error({ err }, 'unhandled error')
  return c.json(errorBody('internal', 'Unexpected error'), 500)
}

/**
 * Resolve an optional capability or refuse with a 503 naming what is not wired.
 * The message is for an operator, so it says which configuration is missing rather
 * than "service unavailable".
 */
export function requireCapability<T>(capability: T | null, message: string): T {
  if (capability === null) throw new UnavailableError(message)
  return capability
}
