import * as v from 'valibot'
import { changeClassSchema, riskScoresSchema } from './risk.js'
import { pullRequestRefSchema } from './vcs.js'

/**
 * A pull request's risk, impact and complexity, as cat-factory's assessor scored
 * them, kept per pull request so every list can show them. A score only: it
 * approves nothing and needs no board row. The risk policy's assessments of
 * board rows record their scores here too.
 */
export const pullRequestAssessmentSchema = v.object({
  pullRequest: pullRequestRefSchema,
  /** The commit that was scored. */
  headSha: v.nullable(v.string()),
  scores: riskScoresSchema,
  changeClass: v.nullable(changeClassSchema),
  rationale: v.nullable(v.string()),
  assessedAt: v.number(),
})
export type PullRequestAssessment = v.InferOutput<typeof pullRequestAssessmentSchema>

export const assessPullRequestSchema = v.object({ pullRequest: pullRequestRefSchema })
export type AssessPullRequest = v.InferOutput<typeof assessPullRequestSchema>

/** How many pull requests one lookup names: a list screen's worth. */
export const MAX_ASSESSMENT_LOOKUP = 200

export const lookUpPullRequestAssessmentsSchema = v.object({
  pullRequests: v.pipe(v.array(pullRequestRefSchema), v.maxLength(MAX_ASSESSMENT_LOOKUP)),
})
export type LookUpPullRequestAssessments = v.InferOutput<typeof lookUpPullRequestAssessmentsSchema>

export const pullRequestAssessmentListSchema = v.object({
  assessments: v.array(pullRequestAssessmentSchema),
})
export type PullRequestAssessmentList = v.InferOutput<typeof pullRequestAssessmentListSchema>
