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
 * Spread into a contract's `responsesByStatusCode` so every non-2xx return is typed
 * for the handler and validated by the client. Exact success codes stay tight;
 * these range keys catch the error halves.
 */
export const errorResponses = {
  '4xx': errorResponseSchema,
  '5xx': errorResponseSchema,
} as const

/**
 * A path-params schema for a single string segment:
 * `singleStringParam('reviewId')` is `withObjectKeys(v.object({ reviewId: v.string() }))`.
 * The mapped type over the single literal key preserves exact per-key typing
 * (`{ reviewId: string }` rather than a widened `Record<string, string>`), so the
 * handler's `c.req.valid('param')` and the client's `pathParams` stay precise.
 */
export function singleStringParam<const K extends string>(key: K) {
  return withObjectKeys(v.object({ [key]: v.string() } as { [P in K]: v.StringSchema<undefined> }))
}
