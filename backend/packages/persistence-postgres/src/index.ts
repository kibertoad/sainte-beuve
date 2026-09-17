// `@sainte-beuve/persistence-postgres`: the durable store the Node service
// boots with.
//
// Eleven stores over Drizzle, against the same eleven tables the D1 adapter
// (@sainte-beuve/persistence-d1) carries, and the two land together because a
// capability durable on one runtime and not the other is the failure mode this
// layout exists to prevent.
//
// What keeps them one behaviour is `@sainte-beuve/persistence-conformance`: the
// same assertions run against this store, the D1 one, and the in-memory one.

import type { Repositories } from '@sainte-beuve/kernel'
import { PostgresAttentionRepository, PostgresReviewCommitmentRepository } from './attention.js'
import { PostgresApiKeyRepository, PostgresSessionRepository } from './auth.js'
import type { PostgresDatabase } from './database.js'
import { PostgresReviewerRepository } from './reviewers.js'
import {
  PostgresAiReviewRunRepository,
  PostgresReminderRepository,
  PostgresReviewRequestRepository,
} from './reviews.js'
import { PostgresIntegrationTokenRepository } from './settings.js'
import { PostgresIdentityRepository, PostgresProjectRepository } from './workspace.js'

/** Every store, over one Drizzle connection. */
export function createPostgresRepositories(db: PostgresDatabase): Repositories {
  return {
    reviewers: new PostgresReviewerRepository(db),
    reviews: new PostgresReviewRequestRepository(db),
    reminders: new PostgresReminderRepository(db),
    aiReviewRuns: new PostgresAiReviewRunRepository(db),
    integrationTokens: new PostgresIntegrationTokenRepository(db),
    projects: new PostgresProjectRepository(db),
    identities: new PostgresIdentityRepository(db),
    attention: new PostgresAttentionRepository(db),
    commitments: new PostgresReviewCommitmentRepository(db),
    sessions: new PostgresSessionRepository(db),
    apiKeys: new PostgresApiKeyRepository(db),
  }
}

export {
  connectPostgres,
  POSTGRES_MIGRATIONS_DIR,
  type PostgresConnection,
  type PostgresDatabase,
  type PostgresOptions,
} from './database.js'
export * as schema from './schema.js'
