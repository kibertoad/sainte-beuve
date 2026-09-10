// `@sainte-beuve/persistence-d1`: the durable store the Cloudflare Worker boots
// with.
//
// Nine stores over one `D1Database`, plus the migrations directory a deployment
// points wrangler at (`migrations_dir`). The Postgres adapter
// (@sainte-beuve/persistence-postgres) implements the same ports over Drizzle,
// against the same tables and the same payload column, and the two land together
// because a capability durable on one runtime and not the other is the failure
// mode this layout exists to prevent.
//
// What keeps them one behaviour is `@sainte-beuve/persistence-conformance`: the
// same assertions run against this store, that one, and the in-memory one.
//
// The tables this adapter reads and writes, and the columns each one carries
// beside its payload. `migrations/0001_initial.sql` is the definition; this is
// the map, and the Postgres schema (`persistence-postgres/src/schema.ts`) is the
// same one in the other dialect's types.
//
//  | table                | key                    | columns beside `data`                                      |
//  | -------------------- | ---------------------- | ---------------------------------------------------------- |
//  | `reviewers`          | `id`                   | `outstanding_reviews`, `created_at`                        |
//  | `review_requests`    | `id`                   | `status`, `pr_owner`, `pr_repo`, `pr_number`, `created_at` |
//  | `reminders`          | `id`                   | `review_id`, `status`, `due_at`                            |
//  | `ai_review_runs`     | `id`                   | `review_id`, `requested_at`                                |
//  | `integration_tokens` | `integration_id`       | `sealed`, `hint`, `subject`, `updated_at` (no payload)     |
//  | `projects`           | `id`                   | `ref_key` (UNIQUE), `created_at`                           |
//  | `identities`         | `(provider, subject)`  | `reviewer_id`                                              |
//  | `attention_requests` | `id`                   | `status`, `created_at`                                     |
//  | `review_commitments` | `id`                   | `reviewer_id`, `pull_request_key`, `created_at`            |

import type { Repositories } from '@sainte-beuve/kernel'
import { SqlAttentionRepository, SqlReviewCommitmentRepository } from './attention.js'
import { D1SqlDriver } from './D1SqlDriver.js'
import type { SqlDriver } from './driver.js'
import { SqlReviewerRepository } from './reviewers.js'
import {
  SqlAiReviewRunRepository,
  SqlReminderRepository,
  SqlReviewRequestRepository,
} from './reviews.js'
import { SqlIntegrationTokenRepository } from './settings.js'
import { SqlIdentityRepository, SqlProjectRepository } from './workspace.js'

/** Every store, over one D1 binding. */
export function createD1Repositories(binding: D1Database): Repositories {
  const db: SqlDriver = new D1SqlDriver(binding)
  return {
    reviewers: new SqlReviewerRepository(db),
    reviews: new SqlReviewRequestRepository(db),
    reminders: new SqlReminderRepository(db),
    aiReviewRuns: new SqlAiReviewRunRepository(db),
    integrationTokens: new SqlIntegrationTokenRepository(db),
    projects: new SqlProjectRepository(db),
    identities: new SqlIdentityRepository(db),
    attention: new SqlAttentionRepository(db),
    commitments: new SqlReviewCommitmentRepository(db),
  }
}

export { D1SqlDriver } from './D1SqlDriver.js'
export type { SqlDriver, SqlParam, SqlRow, SqlStatement } from './driver.js'
