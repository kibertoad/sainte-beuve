import { type PullRequestAssessment, pullRequestAssessmentSchema } from '@sainte-beuve/contracts'
import {
  type PullRequestAddress,
  type PullRequestAssessmentRepository,
  pullRequestKey,
} from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, placeholders } from './rows.js'

const TABLE = 'pull_request_assessments'

/** D1 binds at most 100 parameters per statement; one is the org. */
const KEYS_PER_READ = 90

const UPSERT = `INSERT INTO ${TABLE} (org_id, pull_request_key, assessed_at, data)
VALUES (?, ?, ?, ?)
ON CONFLICT (org_id, pull_request_key) DO UPDATE SET
  assessed_at = excluded.assessed_at,
  data = excluded.data`

export class SqlPullRequestAssessmentRepository implements PullRequestAssessmentRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async get(pullRequest: PullRequestAddress): Promise<PullRequestAssessment | null> {
    const row = await this.db.first(
      `SELECT data FROM ${TABLE} WHERE org_id = ? AND pull_request_key = ?`,
      [this.orgId, pullRequestKey(pullRequest)],
    )
    return row === null ? null : decodeData(pullRequestAssessmentSchema, TABLE, row.data)
  }

  async listByPullRequests(
    pullRequests: readonly PullRequestAddress[],
  ): Promise<PullRequestAssessment[]> {
    const keys = [...new Set(pullRequests.map(pullRequestKey))]
    const found: PullRequestAssessment[] = []
    for (let start = 0; start < keys.length; start += KEYS_PER_READ) {
      const chunk = keys.slice(start, start + KEYS_PER_READ)
      const rows = await this.db.all(
        `SELECT data FROM ${TABLE} WHERE org_id = ? AND pull_request_key IN (${placeholders(chunk.length)})`,
        [this.orgId, ...chunk],
      )
      found.push(...decodeRows(pullRequestAssessmentSchema, TABLE, rows))
    }
    return found
  }

  async put(assessment: PullRequestAssessment): Promise<void> {
    await this.db.run(UPSERT, [
      this.orgId,
      pullRequestKey(assessment.pullRequest),
      assessment.assessedAt,
      encodeData(assessment),
    ])
  }
}
