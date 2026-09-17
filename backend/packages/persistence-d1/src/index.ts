// `@sainte-beuve/persistence-d1`: the durable store the Cloudflare Worker boots
// with.
//
// Eleven stores over one `D1Database` and one org, plus the tenancy surface above
// them (`createD1Store`) and the migrations directory a deployment
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
// beside its payload. `migrations/0001_initial.sql` is the definition and
// `0003_orgs.sql` is the tenancy; this is the map, and the Postgres schema
// (`persistence-postgres/src/schema.ts`) is the same one in the other dialect's
// types.
//
// EVERY TABLE BUT `orgs` IS KEYED ON `(org_id, ...)`. The tenancy is in the
// primary key rather than beside it, because a tenancy a query can omit is a
// tenancy a query will omit: with it in the key, a statement that forgot the
// org does not read somebody else's rows, it fails to parse.
//
//  | table                | key                            | columns beside `data`                                      |
//  | -------------------- | ------------------------------ | ---------------------------------------------------------- |
//  | `orgs`               | `id`                           | `slug` (UNIQUE), `created_at`                              |
//  | `reviewers`          | `(org_id, id)`                 | `outstanding_reviews`, `created_at`                        |
//  | `review_requests`    | `(org_id, id)`                 | `status`, `pr_owner`, `pr_repo`, `pr_number`, `created_at` |
//  | `reminders`          | `(org_id, id)`                 | `review_id`, `status`, `due_at`                            |
//  | `ai_review_runs`     | `(org_id, id)`                 | `review_id`, `status`, `requested_at`, `last_polled_at`    |
//  | `integration_tokens` | `(org_id, integration_id)`     | `sealed`, `hint`, `subject`, `updated_at` (no payload)     |
//  | `projects`           | `(org_id, id)`                 | `ref_key` (UNIQUE per org), `created_at`                   |
//  | `identities`         | `(org_id, provider, subject)`  | `reviewer_id`                                              |
//  | `attention_requests` | `(org_id, id)`                 | `status`, `created_at`                                     |
//  | `review_commitments` | `(org_id, id)`                 | `reviewer_id`, `pull_request_key`, `created_at`            |
//  | `sessions`           | `(org_id, id)`                 | `token_digest` (UNIQUE globally), `reviewer_id`, `expires_at` |
//  | `api_keys`           | `(org_id, id)`                 | `token_digest` (UNIQUE globally), `role`, `created_at` (no payload) |

import type { PersistenceProvider } from '@sainte-beuve/kernel'
import { D1SqlDriver } from './D1SqlDriver.js'
import { createD1Persistence } from './provider.js'

/** Every store, over one D1 binding. */
export function createD1Store(binding: D1Database): PersistenceProvider {
  return createD1Persistence(new D1SqlDriver(binding))
}

export { D1SqlDriver } from './D1SqlDriver.js'
export { createD1Persistence } from './provider.js'
export type { SqlDriver, SqlParam, SqlRow, SqlStatement } from './driver.js'
