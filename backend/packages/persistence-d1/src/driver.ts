/**
 * The seam between the stores and D1.
 *
 * Four methods, no query builder: every statement in this package is a string
 * with `?` placeholders, which is D1's own binding syntax, so there is nothing
 * here to translate. What the seam buys is that nine stores never touch
 * `prepare`/`bind`/`all`, so the one D1-specific rule (a statement with no
 * parameters is not bound at all) lives in one class.
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

/** One statement of a batch, with the parameters it is bound to. */
export interface SqlStatement {
  sql: string
  params?: readonly SqlParam[]
}

export interface SqlDriver {
  all(sql: string, params?: readonly SqlParam[]): Promise<SqlRow[]>
  first(sql: string, params?: readonly SqlParam[]): Promise<SqlRow | null>
  run(sql: string, params?: readonly SqlParam[]): Promise<void>
  /**
   * Several statements in ONE round trip, applied as a single transaction.
   *
   * Here because a write per row is a write per network hop on a runtime billed
   * by wall-clock time inside a request budget, and because a cancel that was
   * interrupted halfway would leave a review with half its nudges still
   * scheduled.
   */
  batch(statements: readonly SqlStatement[]): Promise<void>
}
