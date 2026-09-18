/**
 * The one failure a store raises that is not a caller's doing.
 *
 * Beside `repositories.ts` rather than in it for a size budget, not a
 * boundary: it is what those ports throw when a row on disk no longer matches
 * the contract it was written from.
 */

/**
 * A stored payload that does not match the contract it is supposed to be.
 *
 * Raised by the durable stores when a `data` column fails its schema on read.
 * That is a deployment fault rather than a caller's: the row was written by an
 * older contract, or by hand, and nothing the request did can fix it. It is
 * deliberately NOT a `DomainError`, so the shared handler answers 500 and logs it
 * instead of turning it into a refusal that reads as the operator's mistake.
 *
 * The message names the table and the row, because the fix is a statement against
 * that row and an operator should not have to go looking for which one.
 */
export class StoredRowError extends Error {
  readonly table: string
  readonly rowId: string
  readonly issues: readonly string[]

  constructor(table: string, rowId: string, issues: readonly string[]) {
    super(`Stored ${table} row ${rowId} does not match its contract: ${issues.join('; ')}`)
    this.name = new.target.name
    this.table = table
    this.rowId = rowId
    this.issues = issues
  }
}

export function isStoredRowError(err: unknown): err is StoredRowError {
  return err instanceof StoredRowError
}
