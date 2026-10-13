import { defineApiContract } from '@toad-contracts/valibot'
import * as v from 'valibot'
import {
  externalRiskPolicyListSchema,
  listRiskAssessmentsQuerySchema,
  riskAssessmentListSchema,
  riskAssessmentSchema,
  riskAssessmentViewSchema,
  riskPolicySchema,
  riskPolicySettingsSchema,
} from '../risk.js'
import { errorResponses, singleStringParam } from './_shared.js'

// ---------------------------------------------------------------------------
// Risk assessment and the org's risk policy. See RiskController in
// @sainte-beuve/server.
// ---------------------------------------------------------------------------

const reviewIdParams = singleStringParam('reviewId')

export const getRiskPolicyContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/risk-policy',
  responsesByStatusCode: { 200: riskPolicySettingsSchema, ...errorResponses },
})

/** Admin only. Replaces the whole policy. */
export const setRiskPolicyContract = defineApiContract({
  method: 'put',
  pathResolver: () => '/settings/risk-policy',
  requestBodySchema: riskPolicySchema,
  responsesByStatusCode: { 200: riskPolicySettingsSchema, ...errorResponses },
})

/** Admin only. The org's cat-factory risk policies, for the picker. */
export const listExternalRiskPoliciesContract = defineApiContract({
  method: 'get',
  pathResolver: () => '/settings/risk-policy/cat-factory-policies',
  responsesByStatusCode: { 200: externalRiskPolicyListSchema, ...errorResponses },
})

export const getRiskAssessmentContract = defineApiContract({
  method: 'get',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/risk-assessment`,
  responsesByStatusCode: { 200: riskAssessmentViewSchema, ...errorResponses },
})

/**
 * Assess the pull request again, at its current head. Refused while an
 * assessment of it is still in flight, since a cat-factory assessment is billed.
 */
export const requestRiskAssessmentContract = defineApiContract({
  method: 'post',
  requestPathParamsSchema: reviewIdParams,
  pathResolver: ({ reviewId }) => `/reviews/${reviewId}/risk-assessment`,
  requestBodySchema: v.object({}),
  responsesByStatusCode: { 202: riskAssessmentSchema, ...errorResponses },
})

/** The assessments of several board rows at once, for a list that badges each row. */
export const listRiskAssessmentsContract = defineApiContract({
  method: 'get',
  requestQuerySchema: listRiskAssessmentsQuerySchema,
  pathResolver: () => '/risk-assessments',
  responsesByStatusCode: { 200: riskAssessmentListSchema, ...errorResponses },
})
