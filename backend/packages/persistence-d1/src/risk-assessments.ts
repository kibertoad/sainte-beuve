import type { RiskAssessment } from '@sainte-beuve/contracts'
import { RISK_ASSESSMENT_IN_FLIGHT_STATUSES, riskAssessmentSchema } from '@sainte-beuve/contracts'
import type { RiskAssessmentRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, placeholders } from './rows.js'

const TABLE = 'risk_assessments'

/** D1 binds at most 100 parameters per statement; one is the org. */
const IDS_PER_READ = 90

const UPSERT = `INSERT INTO ${TABLE} (org_id, review_id, status, updated_at, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (org_id, review_id) DO UPDATE SET
  status = excluded.status,
  updated_at = excluded.updated_at,
  data = excluded.data`

const IN_FLIGHT = `SELECT data FROM ${TABLE}
WHERE org_id = ? AND status IN (${placeholders(RISK_ASSESSMENT_IN_FLIGHT_STATUSES.length)})
ORDER BY updated_at, review_id
LIMIT ?`

export class SqlRiskAssessmentRepository implements RiskAssessmentRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async get(reviewId: string): Promise<RiskAssessment | null> {
    const row = await this.db.first(
      `SELECT data FROM ${TABLE} WHERE org_id = ? AND review_id = ?`,
      [this.orgId, reviewId],
    )
    return row === null ? null : decodeData(riskAssessmentSchema, TABLE, row.data)
  }

  async listByReviews(reviewIds: readonly string[]): Promise<RiskAssessment[]> {
    const ids = [...new Set(reviewIds)]
    const found: RiskAssessment[] = []
    for (let start = 0; start < ids.length; start += IDS_PER_READ) {
      const chunk = ids.slice(start, start + IDS_PER_READ)
      const rows = await this.db.all(
        `SELECT data FROM ${TABLE} WHERE org_id = ? AND review_id IN (${placeholders(chunk.length)})`,
        [this.orgId, ...chunk],
      )
      found.push(...decodeRows(riskAssessmentSchema, TABLE, rows))
    }
    return found
  }

  async listInFlight(limit: number): Promise<RiskAssessment[]> {
    const rows = await this.db.all(IN_FLIGHT, [
      this.orgId,
      ...RISK_ASSESSMENT_IN_FLIGHT_STATUSES,
      limit,
    ])
    return decodeRows(riskAssessmentSchema, TABLE, rows)
  }

  async put(assessment: RiskAssessment): Promise<RiskAssessment> {
    await this.db.run(UPSERT, [
      this.orgId,
      assessment.reviewId,
      assessment.status,
      assessment.updatedAt,
      encodeData(assessment),
    ])
    return assessment
  }
}
