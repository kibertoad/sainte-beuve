import type { RiskAssessment } from '@sainte-beuve/contracts'
import { RISK_ASSESSMENT_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type { RiskAssessmentRepository } from '@sainte-beuve/kernel'
import { clone } from './clone.js'
import { byText } from './order.js'

const IN_FLIGHT = new Set<RiskAssessment['status']>(RISK_ASSESSMENT_IN_FLIGHT_STATUSES)

/** One org's assessments, keyed by the review they belong to. */
export class InMemoryRiskAssessmentRepository implements RiskAssessmentRepository {
  private readonly rows = new Map<string, RiskAssessment>()

  async get(reviewId: string): Promise<RiskAssessment | null> {
    const row = this.rows.get(reviewId)
    return row === undefined ? null : clone(row)
  }

  async listByReviews(reviewIds: readonly string[]): Promise<RiskAssessment[]> {
    return [...new Set(reviewIds)].flatMap((reviewId) => {
      const row = this.rows.get(reviewId)
      return row === undefined ? [] : [clone(row)]
    })
  }

  async listInFlight(limit: number): Promise<RiskAssessment[]> {
    return [...this.rows.values()]
      .filter((row) => IN_FLIGHT.has(row.status))
      .sort((a, b) => a.updatedAt - b.updatedAt || byText(a.reviewId, b.reviewId))
      .slice(0, limit)
      .map(clone)
  }

  async put(assessment: RiskAssessment): Promise<RiskAssessment> {
    this.rows.set(assessment.reviewId, clone(assessment))
    return clone(assessment)
  }

  async replace(assessment: RiskAssessment, expectedRevision: string): Promise<boolean> {
    if (this.rows.get(assessment.reviewId)?.revision !== expectedRevision) return false
    this.rows.set(assessment.reviewId, clone(assessment))
    return true
  }
}
