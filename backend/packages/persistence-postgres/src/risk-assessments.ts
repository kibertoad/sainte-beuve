import type { RiskAssessment } from '@sainte-beuve/contracts'
import { RISK_ASSESSMENT_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type { RiskAssessmentRepository } from '@sainte-beuve/kernel'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { riskAssessments } from './risk-schema.js'

export class PostgresRiskAssessmentRepository implements RiskAssessmentRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async get(reviewId: string): Promise<RiskAssessment | null> {
    const rows = await this.db
      .select()
      .from(riskAssessments)
      .where(and(eq(riskAssessments.orgId, this.orgId), eq(riskAssessments.reviewId, reviewId)))
    return firstOr(rows)?.data ?? null
  }

  async listByReviews(reviewIds: readonly string[]): Promise<RiskAssessment[]> {
    if (reviewIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(riskAssessments)
      .where(
        and(
          eq(riskAssessments.orgId, this.orgId),
          inArray(riskAssessments.reviewId, [...new Set(reviewIds)]),
        ),
      )
    return rows.map((row) => row.data)
  }

  async listInFlight(limit: number): Promise<RiskAssessment[]> {
    const rows = await this.db
      .select()
      .from(riskAssessments)
      .where(
        and(
          eq(riskAssessments.orgId, this.orgId),
          inArray(riskAssessments.status, [...RISK_ASSESSMENT_IN_FLIGHT_STATUSES]),
        ),
      )
      .orderBy(asc(riskAssessments.updatedAt), asc(riskAssessments.reviewId))
      .limit(limit)
    return rows.map((row) => row.data)
  }

  async put(assessment: RiskAssessment): Promise<RiskAssessment> {
    const row = {
      orgId: this.orgId,
      reviewId: assessment.reviewId,
      status: assessment.status,
      updatedAt: assessment.updatedAt,
      data: assessment,
    }
    await this.db
      .insert(riskAssessments)
      .values(row)
      .onConflictDoUpdate({ target: [riskAssessments.orgId, riskAssessments.reviewId], set: row })
    return assessment
  }
}
