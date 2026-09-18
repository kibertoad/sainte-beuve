import { bigint, customType, text } from 'drizzle-orm/pg-core'
import type * as v from 'valibot'
import { decodePayload } from './rows.js'

/**
 * The three column types every table in `schema.ts` is built from.
 *
 * Beside it rather than in it for a size budget, not a boundary: the tables and
 * the types they are spelled in are one description of one store, and a change
 * to either is a change to both.
 */

/**
 * The tenancy column every table below carries. Spelled once, because twelve
 * copies of `text('org_id').notNull()` is twelve chances to spell one of them
 * nullable.
 */
export function orgId() {
  return text('org_id').notNull()
}

/** Epoch milliseconds, as every contract carries them. */
export function epochMs(name: string) {
  return bigint(name, { mode: 'number' })
}

/**
 * A payload column, read back THROUGH the contract it was written from.
 *
 * Here rather than at the twenty-odd read sites, because a decode that has to be
 * remembered is one that will be forgotten: `fromDriver` runs for every select on
 * the column, including the ones added next slice.
 *
 * `$type` alone says what the compiler should believe about the payload, which is a
 * claim about code rather than about the rows already on disk. Nothing downstream
 * checks them either, since `buildHonoRoute` validates requests and never
 * responses, so a row written by an older contract reaches the browser and is
 * refused there, as a broken screen naming a route rather than a row somebody can
 * fix. Parsing also HEALS the ordinary case, because the contracts carry defaults
 * for a field added after the row was written.
 *
 * The declared type stays `jsonb`, so this is a read-time change with no migration
 * behind it.
 */
export function payload<T>(name: string, table: string, schema: v.GenericSchema) {
  return customType<{ data: T; driverData: unknown }>({
    dataType: () => 'jsonb',
    fromDriver: (value) => decodePayload(table, schema, value) as T,
  })(name)
}
