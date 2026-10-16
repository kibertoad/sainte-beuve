import type { PullRequestAssessment } from '@sainte-beuve/contracts'
import { pullRequestAssessmentSchema } from '@sainte-beuve/contracts'
import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { epochMs, orgId, payload } from './columns.js'

/** One assessment per pull request, keyed by it rather than by a board row. */
export const pullRequestAssessments = pgTable(
  'pull_request_assessments',
  {
    orgId: orgId(),
    pullRequestKey: text('pull_request_key').notNull(),
    assessedAt: epochMs('assessed_at').notNull(),
    data: payload<PullRequestAssessment>(
      'data',
      'pull_request_assessments',
      pullRequestAssessmentSchema,
    ).notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.pullRequestKey] })],
)
