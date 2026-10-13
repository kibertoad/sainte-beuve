import * as v from 'valibot'
import { aiReviewSeveritySchema } from './ai-review.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Risk assessment and the risk policy.
//
// Every pull request the board tracks can be scored on three axes, each 0..1:
// how complex the change is, how likely it is to break something, and how much
// it reaches. A risk policy says which scores a pull request may carry and still
// be approved with nobody looking. The scores come from cat-factory when an org
// connected it, and from a deterministic reading of the changed files when not.
// See docs/risk-policy.md.
// ---------------------------------------------------------------------------

export const riskScoreSchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1))

export const RISK_AXES = ['complexity', 'risk', 'impact'] as const
export const riskAxisSchema = v.picklist(RISK_AXES)
export type RiskAxis = v.InferOutput<typeof riskAxisSchema>

export const riskScoresSchema = v.object({
  complexity: riskScoreSchema,
  risk: riskScoreSchema,
  impact: riskScoreSchema,
})
export type RiskScores = v.InferOutput<typeof riskScoresSchema>

/**
 * What kind of change a pull request is, from its changed paths alone. A mixed
 * diff takes the riskiest class present, so a rule for `docs` never fires on a
 * diff that also touches code. `unknown` means the file list could not be read.
 */
export const CHANGE_CLASSES = [
  'docs',
  'test',
  'dependency',
  'config',
  'source',
  'schema',
  'unknown',
] as const
export const changeClassSchema = v.picklist(CHANGE_CLASSES)
export type ChangeClass = v.InferOutput<typeof changeClassSchema>

/** The classes a rule may name. `unknown` always falls back to the score ceilings. */
export const RULEABLE_CHANGE_CLASSES = [
  'docs',
  'test',
  'dependency',
  'config',
  'source',
  'schema',
] as const
export type RuleableChangeClass = (typeof RULEABLE_CHANGE_CLASSES)[number]

/**
 * `always` approves a class whatever its scores, `never` holds it for a person,
 * and `thresholds` (the default for an absent class) compares the scores.
 */
export const changeClassRuleSchema = v.picklist(['always', 'thresholds', 'never'])
export type ChangeClassRule = v.InferOutput<typeof changeClassRuleSchema>

export const changeClassRulesSchema = v.partial(
  v.strictObject(
    Object.fromEntries(RULEABLE_CHANGE_CLASSES.map((c) => [c, changeClassRuleSchema])) as {
      [K in RuleableChangeClass]: typeof changeClassRuleSchema
    },
  ),
)
export type ChangeClassRules = v.InferOutput<typeof changeClassRulesSchema>

/** Who scores a pull request. */
export const riskAssessorSchema = v.picklist(['heuristic', 'cat-factory'])
export type RiskAssessor = v.InferOutput<typeof riskAssessorSchema>

/**
 * Whose ceilings a score is held to. `cat-factory` hands the verdict to the
 * cat-factory risk policy named by `catFactoryPolicyId`, so it needs cat-factory
 * as the assessor too: it only scores what it reads itself.
 */
export const riskPolicySourceSchema = v.picklist(['native', 'cat-factory'])
export type RiskPolicySource = v.InferOutput<typeof riskPolicySourceSchema>

const riskPolicyEntries = {
  /** Score every pull request the board starts tracking. Off, nothing is assessed. */
  assess: v.optional(v.boolean(), false),
  assessor: v.optional(riskAssessorSchema, 'heuristic'),
  policySource: v.optional(riskPolicySourceSchema, 'native'),
  /** The cat-factory policy to evaluate against; null takes its unattended default. */
  catFactoryPolicyId: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120))), null),
  /** The native ceilings: a pull request is within policy when every score is at or below its own. */
  maxComplexity: v.optional(riskScoreSchema, 0.3),
  maxRisk: v.optional(riskScoreSchema, 0.2),
  maxImpact: v.optional(riskScoreSchema, 0.3),
  classRules: v.optional(changeClassRulesSchema, () => ({})),
  /** Approve a pull request that is within policy, with no person involved. */
  autoApprove: v.optional(v.boolean(), false),
  /**
   * Run cat-factory's AI review before approving, and approve only when it
   * comes back with nothing at `blockingSeverity` or worse.
   */
  requireAiReview: v.optional(v.boolean(), false),
  blockingSeverity: v.optional(aiReviewSeveritySchema, 'medium'),
}

const CONSISTENT_SOURCES =
  'a cat-factory risk policy can only judge a pull request cat-factory assessed'

export const riskPolicySchema = v.pipe(
  v.object(riskPolicyEntries),
  v.check(
    (policy) => policy.policySource === 'native' || policy.assessor === 'cat-factory',
    CONSISTENT_SOURCES,
  ),
)
export type RiskPolicy = v.InferOutput<typeof riskPolicySchema>
export type RiskPolicyInput = v.InferInput<typeof riskPolicySchema>

export function defaultRiskPolicy(): RiskPolicy {
  return v.parse(riskPolicySchema, {})
}

/**
 * Why a pull request is, or is not, within policy. The cat-factory reasons are
 * the ones its own verdict can carry: `policy_disabled` is a cat-factory policy
 * that never lands anything unattended, and `no_rationale` an assessment that
 * gave scores without saying why.
 */
export const riskVerdictReasonSchema = v.picklist([
  'within_thresholds',
  'exceeded_thresholds',
  'class_auto_approve',
  'class_requires_review',
  'policy_disabled',
  'no_rationale',
])
export type RiskVerdictReason = v.InferOutput<typeof riskVerdictReasonSchema>

export const riskVerdictSchema = v.object({
  outcome: v.picklist(['within_policy', 'requires_review']),
  reason: riskVerdictReasonSchema,
  exceededAxes: v.array(riskAxisSchema),
  /** The policy that decided, as a person reads it: `native`, or the cat-factory policy's name. */
  policyName: v.string(),
})
export type RiskVerdict = v.InferOutput<typeof riskVerdictSchema>

/**
 * Where one pull request's assessment stands.
 *
 * - `pending`: queued, nothing scored yet.
 * - `awaiting_ai_review`: within policy, and waiting on the AI review the policy requires.
 * - `approved`: approved on the host by the configured approver.
 * - `within_policy`: within policy but not approved; `holdReason` says why.
 * - `requires_review`: outside policy, or the AI review found something; a person reviews it.
 * - `failed`: it could not be scored; `holdReason` says why.
 */
export const RISK_ASSESSMENT_STATUSES = [
  'pending',
  'awaiting_ai_review',
  'approved',
  'within_policy',
  'requires_review',
  'failed',
] as const
export const riskAssessmentStatusSchema = v.picklist(RISK_ASSESSMENT_STATUSES)
export type RiskAssessmentStatus = v.InferOutput<typeof riskAssessmentStatusSchema>

/** The states the clock still drives. */
export const RISK_ASSESSMENT_IN_FLIGHT_STATUSES: readonly RiskAssessmentStatus[] = [
  'pending',
  'awaiting_ai_review',
]

export const riskAssessmentSchema = v.object({
  /** One assessment per board row, replaced when the pull request is assessed again. */
  reviewId: v.string(),
  pullRequest: pullRequestRefSchema,
  status: riskAssessmentStatusSchema,
  assessor: riskAssessorSchema,
  /** The commit that was scored; null until it has been read. */
  headSha: v.nullable(v.string()),
  changeClass: v.nullable(changeClassSchema),
  changedFileCount: v.nullable(v.number()),
  scores: v.nullable(riskScoresSchema),
  rationale: v.nullable(v.string()),
  verdict: v.nullable(riskVerdictSchema),
  /** Why a pull request within policy was not approved, or why scoring failed. */
  holdReason: v.nullable(v.string()),
  /** The AI review the policy asked for before approving. */
  aiReviewRunId: v.nullable(v.string()),
  /** The account the approval was posted as. */
  approvedAs: v.nullable(v.string()),
  /** The host's id for that approval, so it can be withdrawn when new commits arrive. */
  approvalId: v.nullable(v.string()),
  attempts: v.number(),
  /** Changes on every write. A step writes only over the revision it read. */
  revision: v.string(),
  requestedAt: v.number(),
  updatedAt: v.number(),
})
export type RiskAssessment = v.InferOutput<typeof riskAssessmentSchema>

/** A cat-factory risk policy, as a picker lists it. */
export const externalRiskPolicySchema = v.object({
  policyId: v.string(),
  name: v.string(),
  isUnattendedDefault: v.boolean(),
  autoMergeEnabled: v.boolean(),
})
export type ExternalRiskPolicy = v.InferOutput<typeof externalRiskPolicySchema>

export const externalRiskPolicyListSchema = v.object({
  policies: v.array(externalRiskPolicySchema),
  /** Why the list could not be read (an unconfigured cat-factory, a key without the scope). */
  unavailableReason: v.nullable(v.string()),
})
export type ExternalRiskPolicyList = v.InferOutput<typeof externalRiskPolicyListSchema>

/** The account approvals go out as on one host, or why there is none. */
export const approverStatusSchema = v.object({
  source: v.nullable(v.picklist(['token', 'app'])),
  username: v.nullable(v.string()),
})
export type ApproverStatus = v.InferOutput<typeof approverStatusSchema>

export const riskPolicySettingsSchema = v.object({
  policy: riskPolicySchema,
  approvers: v.object({ github: approverStatusSchema, gitlab: approverStatusSchema }),
  /** cat-factory is configured for this org, so it can assess and judge. */
  catFactoryAvailable: v.boolean(),
})
export type RiskPolicySettings = v.InferOutput<typeof riskPolicySettingsSchema>

export const riskAssessmentViewSchema = v.object({
  assessment: v.nullable(riskAssessmentSchema),
})
export type RiskAssessmentView = v.InferOutput<typeof riskAssessmentViewSchema>

export const riskAssessmentListSchema = v.object({
  assessments: v.array(riskAssessmentSchema),
})
export type RiskAssessmentList = v.InferOutput<typeof riskAssessmentListSchema>

export const listRiskAssessmentsQuerySchema = v.object({
  /** Comma-separated board row ids, at most 200. */
  reviewIds: v.pipe(v.string(), v.maxLength(200 * 64)),
})
