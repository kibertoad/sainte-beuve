import { withObjectKeys } from '@toad-contracts/valibot'
import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Shared building blocks for the route contracts (`routes/<domain>.ts`). A
// contract is the single source of truth for path, method, request and response,
// consumed by the backend (`buildHonoRoute`) and by the frontend client
// (`sendByApiContract`). See @sainte-beuve/server for the wiring.
// ---------------------------------------------------------------------------

/**
 * The error envelope every controller emits, produced by the shared error handler
 * (domain errors) and by the contract request validator (`{ code: 'validation' }`).
 */
export const errorResponseSchema = v.object({
  error: v.object({
    code: v.string(),
    message: v.string(),
    details: v.optional(v.unknown()),
  }),
})
export type ErrorResponse = v.InferOutput<typeof errorResponseSchema>

/**
 * The dotted field path a validation issue names, as a person would write the field.
 *
 * Both sides of a route need it and neither can guess it. A Standard Schema issue
 * addresses a field either by the key itself or by a SEGMENT wrapping that key, and
 * valibot emits the second form, so the obvious `String(segment)` yields
 * `[object Object]` and names nothing. The server puts this in the envelope's
 * `details` and the client reads it back to say which field was refused.
 */
export function issuePath(issue: { readonly path?: readonly unknown[] }): string {
  return (issue.path ?? [])
    .map((segment) =>
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? String((segment as { key: unknown }).key)
        : String(segment),
    )
    .join('.')
}

/**
 * Spread into a contract's `responsesByStatusCode` so every non-2xx return is typed
 * for the handler and validated by the client. Exact success codes stay tight;
 * these range keys catch the error halves.
 */
export const errorResponses = {
  '4xx': errorResponseSchema,
  '5xx': errorResponseSchema,
} as const

/**
 * A path-params schema over string segments:
 * `stringParams('runId', 'findingId')` is
 * `withObjectKeys(v.object({ runId: v.string(), findingId: v.string() }))`.
 * The mapped type over the literal keys preserves exact per-key typing
 * (`{ runId: string }` rather than a widened `Record<string, string>`), so the
 * handler's `c.req.valid('param')` and the client's `pathParams` stay precise.
 */
export function stringParams<const K extends string>(...keys: K[]) {
  return withObjectKeys(
    v.object(
      Object.fromEntries(keys.map((key) => [key, v.string()])) as {
        [P in K]: v.StringSchema<undefined>
      },
    ),
  )
}

/** The one-segment case, which is most of them. See {@link stringParams}. */
export function singleStringParam<const K extends string>(key: K) {
  return stringParams(key)
}
