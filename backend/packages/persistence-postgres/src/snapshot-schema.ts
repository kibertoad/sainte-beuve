import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import * as v from 'valibot'
import { epochMs, orgId, payload } from './columns.js'

/** Kept host reads. The reader decodes `data` against its own schema, so any JSON is accepted here. */
export const hostSnapshots = pgTable(
  'host_snapshots',
  {
    orgId: orgId(),
    source: text('source').notNull(),
    key: text('key').notNull(),
    fetchedAt: epochMs('fetched_at').notNull(),
    data: payload<unknown>('data', 'host_snapshots', v.unknown()).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.source, table.key] })],
)
