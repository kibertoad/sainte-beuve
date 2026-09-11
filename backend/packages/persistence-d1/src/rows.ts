import { issuePath } from '@sainte-beuve/contracts'
import { StoredRowError } from '@sainte-beuve/kernel'
import { type GenericSchema, type InferOutput, safeParse } from 'valibot'
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

/**
 * The row's own id, read off the payload.
 *
 * Every read here is `SELECT data`, and the payload IS the row, so its `id` is both
 * present and authoritative. Worth the defensive read: this runs on the path where
 * the payload has ALREADY failed its schema, so nothing about its shape is certain.
 */
function payloadId(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'id' in payload
    ? String((payload as { id: unknown }).id)
    : 'unknown'
}

/**
 * Read a `data` column back, THROUGH the schema it was written from.
 *
 * SQLite stores the payload as `TEXT` and hands back the text, so a read is the one
 * moment anything can check that what is on disk is still what the contract says.
 * Nothing downstream does: `buildHonoRoute` validates requests and never responses,
 * so a row written by an older contract travels to the browser and is refused there,
 * as a broken screen naming a route rather than a row somebody can go and fix.
 *
 * Parsing here also HEALS the ordinary case, because the contracts carry defaults
 * for exactly it: a field added since the row was written arrives as its default
 * rather than as an `undefined` behind a type promising otherwise.
 */
export function decodeData<TSchema extends GenericSchema>(
  schema: TSchema,
  table: string,
  value: unknown,
): InferOutput<TSchema> {
  const payload: unknown = JSON.parse(String(value))
  const parsed = safeParse(schema, payload)
  if (parsed.success) return parsed.output
  throw new StoredRowError(
    table,
    payloadId(payload),
    parsed.issues.map((issue) => `${issuePath(issue)}: ${issue.message}`),
  )
}

/** Every row's payload, in the order the query returned them. */
export function decodeRows<TSchema extends GenericSchema>(
  schema: TSchema,
  table: string,
  rows: readonly SqlRow[],
): InferOutput<TSchema>[] {
  return rows.map((row) => decodeData(schema, table, row.data))
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
