import { defineApiContract } from '@toad-contracts/valibot'
import {
  assessPullRequestSchema,
  lookUpPullRequestAssessmentsSchema,
  pullRequestAssessmentListSchema,
  pullRequestAssessmentSchema,
} from '../pull-request-assessments.js'
import { errorResponses } from './_shared.js'

/**
 * Assess a pull request with cat-factory's assessor, unless it was assessed
 * before, when the stored assessment is answered without asking again.
 */
export const assessPullRequestContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/pull-request-assessments',
  requestBodySchema: assessPullRequestSchema,
  responsesByStatusCode: { 200: pullRequestAssessmentSchema, ...errorResponses },
})

/** The stored assessments of a list's pull requests. A POST for its body, not because it writes. */
export const lookUpPullRequestAssessmentsContract = defineApiContract({
  method: 'post',
  pathResolver: () => '/pull-request-assessments/lookup',
  requestBodySchema: lookUpPullRequestAssessmentsSchema,
  responsesByStatusCode: { 200: pullRequestAssessmentListSchema, ...errorResponses },
})
