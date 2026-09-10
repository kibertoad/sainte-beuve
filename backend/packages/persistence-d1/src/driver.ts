/**
 * The seam between the stores and D1.
 *
 * Three methods, no query builder: every statement in this package is a string
 * with `?` placeholders, which is D1's own binding syntax, so there is nothing
 * here to translate. What the seam buys is that nine stores never touch
 * `prepare`/`bind`/`all`, and that the suite has one place to reach in from.
 *
 * The Postgres adapter (@sainte-beuve/persistence-postgres) is a separate
 * implementation over Drizzle, against the same table layout. Nothing keeps the
 * two in step except the conformance suite both of them run, which is exactly
 * what that suite is for.
 */

/** What a statement can be parameterised with. Everything else is encoded first. */
export type SqlParam = string | number | null

/** One row as D1 hands it back: column names to values, undecoded. */
export type SqlRow = Record<string, unknown>

export interface SqlDriver {
  all(sql: string, params?: readonly SqlParam[]): Promise<SqlRow[]>
  first(sql: string, params?: readonly SqlParam[]): Promise<SqlRow | null>
  run(sql: string, params?: readonly SqlParam[]): Promise<void>
}
