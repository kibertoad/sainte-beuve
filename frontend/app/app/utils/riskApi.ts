import type { RiskPolicyInput } from '@sainte-beuve/contracts'
import {
  getRiskAssessmentContract,
  getRiskPolicyContract,
  listExternalRiskPoliciesContract,
  listRiskAssessmentsContract,
  requestRiskAssessmentContract,
  setRiskPolicyContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The risk policy and the assessments it produces.
export function riskCalls(call: ContractCaller) {
  return {
    getRiskPolicy: () => call(getRiskPolicyContract, {}),
    setRiskPolicy: (policy: RiskPolicyInput) => call(setRiskPolicyContract, { body: policy }),
    listExternalRiskPolicies: () => call(listExternalRiskPoliciesContract, {}),
    getRiskAssessment: (reviewId: string) =>
      call(getRiskAssessmentContract, { pathParams: { reviewId } }),
    requestRiskAssessment: (reviewId: string) =>
      call(requestRiskAssessmentContract, { pathParams: { reviewId }, body: {} }),
    listRiskAssessments: (reviewIds: readonly string[]) =>
      call(listRiskAssessmentsContract, { queryParams: { reviewIds: reviewIds.join(',') } }),
  }
}
