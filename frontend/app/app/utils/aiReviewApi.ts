import type { AiReviewResolution, RequestPullRequestAiReviewInput } from '@sainte-beuve/contracts'
import {
  challengeAiReviewFindingContract,
  dismissAiReviewFindingContract,
  listAiReviewRunsContract,
  requestAiReviewContract,
  requestPullRequestAiReviewContract,
  resolveAiReviewContract,
  resumeAiReviewContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The AI-review loop. Filing is addressed by review or by pull request;
// everything after it by the delegated RUN, the way cat-factory's own decision
// surface is.
export function aiReviewCalls(call: ContractCaller) {
  return {
    requestAiReview: (reviewId: string, instructions: string | null = null) =>
      call(requestAiReviewContract, { pathParams: { reviewId }, body: { instructions } }),
    /**
     * The same filing from a row that may not be on the board yet. The run names
     * the board row (`reviewId`) it was filed on, which is where it is curated.
     */
    requestPullRequestAiReview: (body: RequestPullRequestAiReviewInput) =>
      call(requestPullRequestAiReviewContract, { body }),
    /** Every delegated run for one review. Each in-flight one is POLLED to answer this. */
    listAiReviewRuns: (reviewId: string) =>
      call(listAiReviewRunsContract, { pathParams: { reviewId } }),
    dismissAiReviewFinding: (runId: string, findingId: string) =>
      call(dismissAiReviewFindingContract, { pathParams: { runId, findingId }, body: {} }),
    /** Send one finding to the investigator. The verdict lands on a later read. */
    challengeAiReviewFinding: (runId: string, findingId: string, question: string | null) =>
      call(challengeAiReviewFindingContract, {
        pathParams: { runId, findingId },
        body: { question },
      }),
    /**
     * Act on the curated selection. The answer is the run having ACCEPTED the
     * instruction: cat-factory posts asynchronously, and what landed shows up on a
     * later read as the curation's `postReport`.
     */
    resolveAiReview: (runId: string, action: AiReviewResolution, findingIds: string[]) =>
      call(resolveAiReviewContract, { pathParams: { runId }, body: { action, findingIds } }),
    resumeAiReview: (runId: string) =>
      call(resumeAiReviewContract, { pathParams: { runId }, body: {} }),
  }
}
