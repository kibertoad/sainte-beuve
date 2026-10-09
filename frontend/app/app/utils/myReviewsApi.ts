import type { MyReviewsQuery } from '@sainte-beuve/contracts'
import { listMyReviewsContract } from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// My Reviews: other people's pull requests the viewer has a part in.
export function myReviewCalls(call: ContractCaller) {
  return {
    listMyReviews: (query: MyReviewsQuery) => call(listMyReviewsContract, { queryParams: query }),
  }
}
