import type { IdentityProvider, LinkedIdentity, Project } from '@sainte-beuve/contracts'
import type { IdentityRepository, ProjectRepository } from '@sainte-beuve/kernel'
import { projectRefKey } from '@sainte-beuve/kernel'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { identities, projects } from './schema.js'

/** The projects a deployment watches, and who its people are on each host. */
export class PostgresProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.orgId, this.orgId))
      .orderBy(asc(projects.createdAt), asc(projects.id))
    return rows.map((row) => row.data)
  }

  async getById(projectId: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, this.orgId), eq(projects.id, projectId)))
    return firstOr(rows)?.data ?? null
  }

  async getByRef(ref: { provider: string; owner: string; repo: string }): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, this.orgId), eq(projects.refKey, projectRefKey(ref))))
    return firstOr(rows)?.data ?? null
  }

  async create(project: Project): Promise<Project> {
    await this.write(project)
    return project
  }

  async update(projectId: string, patch: Partial<Project>): Promise<Project | null> {
    const current = await this.getById(projectId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  async delete(projectId: string): Promise<void> {
    await this.db
      .delete(projects)
      .where(and(eq(projects.orgId, this.orgId), eq(projects.id, projectId)))
  }

  private async write(project: Project): Promise<void> {
    // `(org_id, ref_key)` is UNIQUE, which is the uniqueness the port declares
    // and the in-memory store can only promise. It is scoped to the org because
    // two tenancies watching one repository is the ordinary multi-tenant case
    // rather than a duplicate. Registering a repository twice within one org is
    // refused by the service, so reaching the constraint means two of those
    // calls raced, and the loser being told beats a workspace listing one
    // repository twice.
    const row = {
      orgId: this.orgId,
      id: project.id,
      refKey: projectRefKey(project),
      createdAt: project.createdAt,
      data: project,
    }
    await this.db
      .insert(projects)
      .values(row)
      .onConflictDoUpdate({ target: [projects.orgId, projects.id], set: row })
  }
}

/**
 * The `(provider, subject)` claim, settled in ONE statement.
 *
 * `link` has to answer "whose account is this NOW", and the answer is not
 * always the reviewer that was passed in: two first sign-ins that both found no
 * row are how a directory forks into two people with one account between them.
 * The primary key decides it, the conflict branch leaves the holder's
 * `reviewer_id` alone, and `RETURNING` reports who won. A caller that already
 * holds the key refreshes the handle on the same trip, which is what keeps a
 * rename visible.
 */
export class PostgresIdentityRepository implements IdentityRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async findReviewerId(provider: IdentityProvider, subject: string): Promise<string | null> {
    const rows = await this.db
      .select({ reviewerId: identities.reviewerId })
      .from(identities)
      .where(
        and(
          eq(identities.orgId, this.orgId),
          eq(identities.provider, provider),
          eq(identities.subject, subject),
        ),
      )
    return firstOr(rows)?.reviewerId ?? null
  }

  async listForReviewer(reviewerId: string): Promise<LinkedIdentity[]> {
    const rows = await this.db
      .select()
      .from(identities)
      .where(and(eq(identities.orgId, this.orgId), eq(identities.reviewerId, reviewerId)))
      .orderBy(asc(identities.provider), asc(identities.subject))
    return rows.map((row) => row.data)
  }

  async link(reviewerId: string, identity: LinkedIdentity): Promise<string> {
    const rows = await this.db
      .insert(identities)
      .values({
        orgId: this.orgId,
        provider: identity.provider,
        subject: identity.subject,
        reviewerId,
        data: identity,
      })
      .onConflictDoUpdate({
        target: [identities.orgId, identities.provider, identities.subject],
        set: {
          data: sql`CASE WHEN ${identities.reviewerId} = excluded.reviewer_id THEN excluded.data ELSE ${identities.data} END`,
        },
      })
      .returning({ reviewerId: identities.reviewerId })
    // The statement always returns its row, whether it inserted or conflicted.
    return firstOr(rows)?.reviewerId ?? reviewerId
  }
}
