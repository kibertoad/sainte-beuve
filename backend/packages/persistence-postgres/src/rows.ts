import { issuePath } from '@sainte-beuve/contracts'
import { StoredRowError } from '@sainte-beuve/kernel'
import * as v from 'valibot'

/**
 * The two rules every store here shares.
 *
 * Small enough to inline and load-bearing enough not to: a patch that let an id
 * through would move a row to another key on one store and not on the others,
 * and `first` spelt by hand nine times is nine chances to read `rows[0]` off an
 * empty result.
 */

/** Apply a patch to a stored row. The id is never patchable. */
export function patched<Row extends { id: string }>(row: Row, patch: Partial<Row>): Row {
  return { ...row, ...patch, id: row.id }
}

/** The single row a point read asked for, or null. */
export function firstOr<Row>(rows: readonly Row[]): Row | null {
  return rows[0] ?? null
}

/**
 * A stored payload, through the schema it was written from.
 *
 * Called from the `payload` column type in `schema.ts`, so it runs on every read of
 * every `data` column rather than at each of the twenty-odd places that read one.
 *
 * The id comes off the payload because the payload IS the row and carries its own,
 * and the read is defensive: this path only runs once the payload has already failed
 * its schema, so nothing about its shape is certain.
 */
export function decodePayload(table: string, schema: v.GenericSchema, value: unknown): unknown {
  const parsed = v.safeParse(schema, value)
  if (parsed.success) return parsed.output
  const rowId =
    typeof value === 'object' && value !== null && 'id' in value
      ? String((value as { id: unknown }).id)
      : 'unknown'
  throw new StoredRowError(
    table,
    rowId,
    parsed.issues.map((issue) => `${issuePath(issue)}: ${issue.message}`),
  )
}
