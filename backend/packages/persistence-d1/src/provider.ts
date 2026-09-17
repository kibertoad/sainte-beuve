import { projectRefKey } from '@sainte-beuve/kernel'
import type {
  PersistenceProvider,
  Repositories,
  StoredApiKey,
  StoredSession,
  TenancyDirectory,
} from '@sainte-beuve/kernel'
import {
  KEY_BY_DIGEST,
  SESSION_BY_DIGEST,
  SqlApiKeyRepository,
  SqlSessionRepository,
  toKey,
  toSession,
} from './auth.js'
import { SqlAttentionRepository, SqlReviewCommitmentRepository } from './attention.js'
import type { SqlDriver } from './driver.js'
import { SqlOrgRepository } from './orgs.js'
import { SqlReviewerRepository } from './reviewers.js'
import {
  SqlAiReviewRunRepository,
  SqlReminderRepository,
  SqlReviewRequestRepository,
} from './reviews.js'
import { SqlIntegrationTokenRepository } from './settings.js'
import { SqlIdentityRepository, SqlProjectRepository } from './workspace.js'

/**
 * The D1 store as a whole deployment sees it.
 *
 * `forOrg` binds an id and builds eleven statement holders, which is what makes
 * it cheap enough to call on every request: nothing here touches the database,
 * and the binding is the ONLY thing the repositories carry beyond the driver.
 *
 * The three reads below are the only statements in this package with no
 * `org_id` in them, and they are the three that decide which org a request is
 * in. Keeping them here rather than on the stores is what makes that list
 * countable: a reviewer, a review or a reminder cannot be read without a
 * tenancy, because there is no method anywhere that would do it.
 */
class D1Persistence implements PersistenceProvider {
  readonly orgs: SqlOrgRepository
  readonly tenancy: TenancyDirectory

  constructor(private readonly db: SqlDriver) {
    this.orgs = new SqlOrgRepository(db)
    this.tenancy = {
      findSessionByDigest: async (tokenDigest) => this.sessionByDigest(tokenDigest),
      findApiKeyByDigest: async (tokenDigest) => this.keyByDigest(tokenDigest),
      findOrgIdForProject: async (ref) => this.orgIdForProject(ref),
    }
  }

  forOrg(orgId: string): Repositories {
    const db = this.db
    return {
      reviewers: new SqlReviewerRepository(db, orgId),
      reviews: new SqlReviewRequestRepository(db, orgId),
      reminders: new SqlReminderRepository(db, orgId),
      aiReviewRuns: new SqlAiReviewRunRepository(db, orgId),
      integrationTokens: new SqlIntegrationTokenRepository(db, orgId),
      projects: new SqlProjectRepository(db, orgId),
      identities: new SqlIdentityRepository(db, orgId),
      attention: new SqlAttentionRepository(db, orgId),
      commitments: new SqlReviewCommitmentRepository(db, orgId),
      sessions: new SqlSessionRepository(db, orgId),
      apiKeys: new SqlApiKeyRepository(db, orgId),
    }
  }

  private async sessionByDigest(tokenDigest: string): Promise<StoredSession | null> {
    const row = await this.db.first(SESSION_BY_DIGEST, [tokenDigest])
    return row === null ? null : toSession(row)
  }

  private async keyByDigest(tokenDigest: string): Promise<StoredApiKey | null> {
    const row = await this.db.first(KEY_BY_DIGEST, [tokenDigest])
    return row === null ? null : toKey(row)
  }

  /**
   * `ORDER BY created_at, id` so a repository two tenancies both registered
   * answers with the first claim rather than with whichever row the planner
   * reached, which would make an inbound delivery land in a different org from
   * one minute to the next.
   */
  private async orgIdForProject(ref: {
    provider: string
    owner: string
    repo: string
  }): Promise<string | null> {
    const row = await this.db.first(
      'SELECT org_id FROM projects WHERE ref_key = ? ORDER BY created_at, id',
      [projectRefKey(ref)],
    )
    return row === null ? null : String(row.org_id)
  }
}

/** The whole D1 store, orgs and all. */
export function createD1Persistence(db: SqlDriver): PersistenceProvider {
  return new D1Persistence(db)
}
