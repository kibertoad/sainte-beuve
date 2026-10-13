import * as v from 'valibot'

/**
 * Which external source a reviewer or a team came from, and its id there. Set
 * on a row an external directory put here, which then owns the fields it lists.
 */
export const externalRefSchema = v.object({
  /** The system the row is synchronised from, `cat-factory` for one. */
  source: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
})
export type ExternalRef = v.InferOutput<typeof externalRefSchema>
