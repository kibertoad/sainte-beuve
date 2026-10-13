import type { RiskAssessment } from '@sainte-beuve/contracts'
import { riskAssessmentSchema } from '@sainte-beuve/contracts'
import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { epochMs, orgId, payload } from './columns.js'

/** One risk assessment per board row. The clock reads `status` and `updated_at`. */
export const riskAssessments = pgTable(
  'risk_assessments',
  {
    orgId: orgId(),
    reviewId: text('review_id').notNull(),
    status: text('status').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
    data: payload<RiskAssessment>('data', 'risk_assessments', riskAssessmentSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.reviewId] }),
    index('risk_assessments_status_idx').on(table.orgId, table.status, table.updatedAt),
  ],
)
