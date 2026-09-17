import type {
  PersistenceProvider,
  Repositories,
  StoredApiKey,
  StoredSession,
  TenancyDirectory,
} from '@sainte-beuve/kernel'
import { projectRefKey } from '@sainte-beuve/kernel'
import { asc, eq } from 'drizzle-orm'
import { PostgresAttentionRepository, PostgresReviewCommitmentRepository } from './attention.js'
import { PostgresApiKeyRepository, PostgresSessionRepository } from './auth.js'
import type { PostgresDatabase } from './database.js'
import { PostgresOrgRepository } from './orgs.js'
import { PostgresReviewerRepository } from './reviewers.js'
import {
  PostgresAiReviewRunRepository,
  PostgresReminderRepository,
  PostgresReviewRequestRepository,
} from './reviews.js'
import { firstOr } from './rows.js'
import { apiKeys, projects, sessions } from './schema.js'
import { PostgresIntegrationTokenRepository } from './settings.js'
import { PostgresIdentityRepository, PostgresProjectRepository } from './workspace.js'

/**
 * The Postgres store as a whole deployment sees it.
 *
 * `forOrg` binds an id and builds eleven query holders, which is what makes it
 * cheap enough to call on every request: nothing here touches the pool, and the
 * binding is the ONLY thing the repositories carry beyond the connection.
 *
 * The three reads below are the only queries in this package with no `org_id` in
 * them, and they are the three that decide which org a request is in. Keeping
 * them here rather than on the stores is what makes that list countable: a
 * reviewer, a review or a reminder cannot be read without a tenancy, because
 * there is no method anywhere that would do it.
 */
class PostgresPersistence implements PersistenceProvider {
  readonly orgs: PostgresOrgRepository
  readonly tenancy: TenancyDirectory

  constructor(private readonly db: PostgresDatabase) {
    this.orgs = new PostgresOrgRepository(db)
    this.tenancy = {
      findSessionByDigest: async (tokenDigest) => this.sessionByDigest(tokenDigest),
      findApiKeyByDigest: async (tokenDigest) => this.keyByDigest(tokenDigest),
      findOrgIdForProject: async (ref) => this.orgIdForProject(ref),
    }
  }

  forOrg(orgId: string): Repositories {
    const db = this.db
    return {
      reviewers: new PostgresReviewerRepository(db, orgId),
      reviews: new PostgresReviewRequestRepository(db, orgId),
      reminders: new PostgresReminderRepository(db, orgId),
      aiReviewRuns: new PostgresAiReviewRunRepository(db, orgId),
      integrationTokens: new PostgresIntegrationTokenRepository(db, orgId),
      projects: new PostgresProjectRepository(db, orgId),
      identities: new PostgresIdentityRepository(db, orgId),
      attention: new PostgresAttentionRepository(db, orgId),
      commitments: new PostgresReviewCommitmentRepository(db, orgId),
      sessions: new PostgresSessionRepository(db, orgId),
      apiKeys: new PostgresApiKeyRepository(db, orgId),
    }
  }

  private async sessionByDigest(tokenDigest: string): Promise<StoredSession | null> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.tokenDigest, tokenDigest))
    return firstOr(rows)
  }

  private async keyByDigest(tokenDigest: string): Promise<StoredApiKey | null> {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.tokenDigest, tokenDigest))
    return firstOr(rows)
  }

  /**
   * Ordered so a repository two tenancies both registered answers with the first
   * claim rather than with whichever row the planner reached, which would make
   * an inbound delivery land in a different org from one minute to the next.
   */
  private async orgIdForProject(ref: {
    provider: string
    owner: string
    repo: string
  }): Promise<string | null> {
    const rows = await this.db
      .select({ orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.refKey, projectRefKey(ref)))
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .limit(1)
    return firstOr(rows)?.orgId ?? null
  }
}

/** The whole Postgres store, orgs and all. */
export function createPostgresPersistence(db: PostgresDatabase): PersistenceProvider {
  return new PostgresPersistence(db)
}
