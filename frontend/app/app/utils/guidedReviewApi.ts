import type {
  AskGuidedReviewInput,
  GuidedReviewTarget,
  OpenGuidedReviewThreadInput,
} from '@sainte-beuve/contracts'
import {
  askGuidedReviewContract,
  findGuidedReviewContract,
  getGuidedReviewContract,
  getGuidedReviewThreadContract,
  openGuidedReviewContract,
  openGuidedReviewThreadContract,
  refreshGuidedReviewContract,
  requestGuidedReviewDraftsContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The guided-review half of the client, split off `sainteBeuveApi.ts` the way
// the Configuration screen's half is: it takes the caller rather than building
// one, so there is still one wretch client and one place a refusal becomes an
// `ApiError`.

export function guidedReviewCalls(call: ContractCaller) {
  return {
    /** The review this deployment already holds for a pull request, or null. Spends nothing. */
    findGuidedReview: (target: GuidedReviewTarget) =>
      call(findGuidedReviewContract, {
        queryParams: { ...target, number: String(target.number) },
      }),
    /** Opens one, or answers with the one already open. A new one spends model budget. */
    openGuidedReview: (target: GuidedReviewTarget) =>
      call(openGuidedReviewContract, { body: target }),
    getGuidedReview: (sessionId: string) =>
      call(getGuidedReviewContract, { pathParams: { sessionId } }),
    refreshGuidedReview: (sessionId: string) =>
      call(refreshGuidedReviewContract, { pathParams: { sessionId }, body: {} }),
    openGuidedReviewThread: (sessionId: string, input: OpenGuidedReviewThreadInput) =>
      call(openGuidedReviewThreadContract, { pathParams: { sessionId }, body: input }),
    getGuidedReviewThread: (sessionId: string, threadId: string) =>
      call(getGuidedReviewThreadContract, { pathParams: { sessionId, threadId } }),
    askGuidedReview: (sessionId: string, threadId: string, input: AskGuidedReviewInput) =>
      call(askGuidedReviewContract, { pathParams: { sessionId, threadId }, body: input }),
    requestGuidedReviewDrafts: (sessionId: string, threadId: string, instructions: string) =>
      call(requestGuidedReviewDraftsContract, {
        pathParams: { sessionId, threadId },
        body: instructions.length > 0 ? { instructions } : {},
      }),
  }
}
