import type { ReviewReportQuery } from '@sainte-beuve/contracts'
import { getReviewReportContract } from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// Reports: review timings across the linked repositories, or in one of them.
export function reportingCalls(call: ContractCaller) {
  return {
    getReviewReport: (query: ReviewReportQuery) =>
      call(getReviewReportContract, { queryParams: query }),
  }
}
