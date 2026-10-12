import type { AttentionRequest, ReviewCommitment } from '@sainte-beuve/contracts'
import { attentionRequestSchema, reviewCommitmentSchema } from '@sainte-beuve/contracts'
import { index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { epochMs, orgId, payload } from './columns.js'

/** Asks for a review, and the promises made against a pull request. */
export const attentionRequests = pgTable(
  'attention_requests',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    status: text('status').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<AttentionRequest>('data', 'attention_requests', attentionRequestSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('attention_requests_status_idx').on(table.orgId, table.status, table.createdAt),
  ],
)

export const reviewCommitments = pgTable(
  'review_commitments',
  {
    orgId: orgId(),
    id: text('id').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    /**
     * `provider:owner/repo#number`. The host is part of the key: the same path
     * and number exist on both, and they are two different changes.
     */
    pullRequestKey: text('pull_request_key').notNull(),
    createdAt: epochMs('created_at').notNull(),
    data: payload<ReviewCommitment>('data', 'review_commitments', reviewCommitmentSchema).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.id] }),
    index('review_commitments_reviewer_idx').on(table.orgId, table.reviewerId, table.createdAt),
  ],
)
