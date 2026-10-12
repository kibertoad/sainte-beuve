import type { ExternalRepository } from '@sainte-beuve/contracts'
import { externalRepositorySchema } from '@sainte-beuve/contracts'
import { bigint, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { orgId, payload } from './columns.js'

/**
 * The repository lists external systems hold for an org, keyed by the source and
 * its own key for the entry. A dropped entry keeps its row with a null
 * `repository`, so its `seq` still refuses an older state.
 */
export const externalRepositories = pgTable(
  'external_repositories',
  {
    orgId: orgId(),
    source: text('source').notNull(),
    key: text('key').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    data: payload<ExternalRepository>(
      'data',
      'external_repositories',
      externalRepositorySchema,
    ).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.source, table.key] })],
)
