import type { SqlParam, SqlRow } from './driver.js'

/**
 * How a domain row becomes a database row, and back.
 *
 * THE PAYLOAD IS THE ROW. Every table stores the contract object as JSON in one
 * `data` column, and the scalar columns beside it are indexes derived from that
 * payload at write time: a status a filter reads, a `due_at` the reminder tick
 * scans, the `(owner, repo, number)` a webhook replay looks a review up by. A
 * read decodes the payload and ignores them.
 *
 * That is a deliberate trade, and it is the shape the ports asked for. They are
 * coarse by design (`listDue`, not a query builder), so the columns a store has
 * to index are a short closed list, while a column per contract field would be
 * nine mappers to keep in step with contracts that still move every slice, plus
 * a JSON column anyway for the arrays and nested objects (a review's assigned
 * reviewers, an AI run's findings and its post report). What it costs is ad-hoc
 * SQL over a field nobody indexed, and no code path here needs one.
 *
 * ONE FIELD IS NOT IN THE PAYLOAD'S GIFT: `reviewers.outstanding_reviews`. Its
 * port method INCREMENTS rather than writes, so two assignments landing together
 * must not read-modify-write over each other; the column is authoritative, the
 * statement is a single `UPDATE`, and the reviewer mapper overlays the column
 * onto the decoded payload. It is the only exception, and `reviewers.ts` is the
 * only place that knows about it.
 *
 * The Postgres adapter stores the same payload in a `jsonb` column of the same
 * name, so the two tables read the same in a database console.
 */

/** Serialise a row for its `data` column. */
export function encodeData(row: unknown): SqlParam {
  return JSON.stringify(row)
}

/** Read a `data` column back. SQLite stores it as `TEXT` and hands back the text. */
export function decodeData<Row>(value: unknown): Row {
  return JSON.parse(String(value)) as Row
}

/** Every row's payload, in the order the query returned them. */
export function decodeRows<Row>(rows: readonly SqlRow[]): Row[] {
  return rows.map((row) => decodeData<Row>(row.data))
}

/** A count column as a number. */
export function decodeCount(value: unknown): number {
  return Number(value)
}

/** Apply a patch to a stored row. The id is never patchable, exactly as in memory. */
export function patched<Row extends { id: string }>(row: Row, patch: Partial<Row>): Row {
  return { ...row, ...patch, id: row.id }
}

/**
 * `?, ?, ?` for a list bound to an `IN`.
 *
 * Never called with an empty list: `IN ()` is a syntax error, and a filter
 * naming no status matches nothing, so the stores answer that from the caller's
 * side without a query.
 */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
