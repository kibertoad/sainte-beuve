import type {
  ChangeClass,
  ExternalRiskPolicy,
  PullRequestRef,
  RiskAssessment,
  RiskScores,
  RiskVerdict,
} from '@sainte-beuve/contracts'

/** The assessments of the board's pull requests, one per board row. */
export interface RiskAssessmentRepository {
  get(reviewId: string): Promise<RiskAssessment | null>
  /** The rows of the named reviews that have one, in no particular order. */
  listByReviews(reviewIds: readonly string[]): Promise<RiskAssessment[]>
  /**
   * The assessments the clock still drives (`RISK_ASSESSMENT_IN_FLIGHT_STATUSES`),
   * least recently updated first, ties broken on the review id.
   */
  listInFlight(limit: number): Promise<RiskAssessment[]>
  /** Store or replace the assessment of one review. */
  put(assessment: RiskAssessment): Promise<RiskAssessment>
}

/** What an external assessor read and concluded about one pull request. */
export interface ExternalRiskAssessment {
  headSha: string
  changeClass: ChangeClass
  changedFileCount: number
  scores: RiskScores
  rationale: string
  verdict: RiskVerdict
}

/**
 * An assessor that scores a pull request and judges it by one of its own risk
 * policies. Refuses with an `UnavailableError` when the instance it reaches has
 * no assessment surface.
 */
export interface RiskAssessmentGateway {
  /**
   * `policyId` null judges by the instance's default for unattended work.
   * `directoryKeys` are the repository's mirror keys, which name the workspace
   * that links it; none asks the key's only workspace.
   */
  assess(input: {
    pullRequest: PullRequestRef
    policyId: string | null
    directoryKeys: readonly string[]
  }): Promise<ExternalRiskAssessment>
  listPolicies(): Promise<ExternalRiskPolicy[]>
}
