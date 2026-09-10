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
