import type { PullRequestAssessment } from '@sainte-beuve/contracts'
import {
  type PullRequestAddress,
  type PullRequestAssessmentRepository,
  pullRequestKey,
} from '@sainte-beuve/kernel'
import { and, eq, inArray } from 'drizzle-orm'
import { pullRequestAssessments } from './assessment-schema.js'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'

/** Keys per `IN` list, so a long list screen stays a few bounded statements. */
const KEYS_PER_READ = 500

export class PostgresPullRequestAssessmentRepository implements PullRequestAssessmentRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async get(pullRequest: PullRequestAddress): Promise<PullRequestAssessment | null> {
    const rows = await this.db
      .select()
      .from(pullRequestAssessments)
      .where(
        and(
          eq(pullRequestAssessments.orgId, this.orgId),
          eq(pullRequestAssessments.pullRequestKey, pullRequestKey(pullRequest)),
        ),
      )
    return firstOr(rows)?.data ?? null
  }

  async listByPullRequests(
    pullRequests: readonly PullRequestAddress[],
  ): Promise<PullRequestAssessment[]> {
    const keys = [...new Set(pullRequests.map(pullRequestKey))]
    const found: PullRequestAssessment[] = []
    for (let start = 0; start < keys.length; start += KEYS_PER_READ) {
      const rows = await this.db
        .select()
        .from(pullRequestAssessments)
        .where(
          and(
            eq(pullRequestAssessments.orgId, this.orgId),
            inArray(
              pullRequestAssessments.pullRequestKey,
              keys.slice(start, start + KEYS_PER_READ),
            ),
          ),
        )
      found.push(...rows.map((row) => row.data))
    }
    return found
  }

  async put(assessment: PullRequestAssessment): Promise<void> {
    const row = { assessedAt: assessment.assessedAt, data: assessment }
    await this.db
      .insert(pullRequestAssessments)
      .values({ ...row, orgId: this.orgId, pullRequestKey: pullRequestKey(assessment.pullRequest) })
      .onConflictDoUpdate({
        target: [pullRequestAssessments.orgId, pullRequestAssessments.pullRequestKey],
        set: row,
      })
  }
}
