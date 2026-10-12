import type {
  AskGuidedReviewInput,
  EditGuidedReviewDraftInput,
  GuidedReviewSession,
  GuidedReviewTarget,
  OpenGuidedReviewThreadInput,
} from '@sainte-beuve/contracts'
import {
  guidedReviewTargetOf,
  askGuidedReviewContract,
  editGuidedReviewDraftContract,
  findGuidedReviewContract,
  getGuidedReviewContract,
  getGuidedReviewThreadContract,
  openGuidedReviewContract,
  openGuidedReviewThreadContract,
  postGuidedReviewDraftsContract,
  refreshGuidedReviewContract,
  requestGuidedReviewDraftsContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The guided-review half of the client, split off `sainteBeuveApi.ts` the way
// the Configuration screen's half is: it takes the caller rather than building
// one, so there is still one wretch client and one place a refusal becomes an
// `ApiError`.

/**
 * A pull request as the query string names it: the lookup, every call about a
 * session, and the session's stream all carry it.
 */
function targetQuery(target: GuidedReviewTarget) {
  const { provider, owner, repo, number } = target
  return { provider, owner, repo, number: String(number) }
}

/**
 * Where a call about a session goes: the session, and the pull request it is
 * about, which the server reads to find the cat-factory workspace holding it.
 */
export function sessionAddress(session: GuidedReviewSession) {
  return {
    pathParams: { sessionId: session.id },
    queryParams: targetQuery(guidedReviewTargetOf(session)),
  }
}

export function guidedReviewCalls(call: ContractCaller) {
  return {
    /** The review this deployment already holds for a pull request, or null. Spends nothing. */
    findGuidedReview: (target: GuidedReviewTarget) =>
      call(findGuidedReviewContract, {
        queryParams: targetQuery(target),
      }),
    /** Opens one, or answers with the one already open. A new one spends model budget. */
    openGuidedReview: (target: GuidedReviewTarget) =>
      call(openGuidedReviewContract, { body: target }),
    getGuidedReview: (session: GuidedReviewSession) =>
      call(getGuidedReviewContract, sessionAddress(session)),
    refreshGuidedReview: (session: GuidedReviewSession) =>
      call(refreshGuidedReviewContract, { ...sessionAddress(session), body: {} }),
    openGuidedReviewThread: (session: GuidedReviewSession, input: OpenGuidedReviewThreadInput) =>
      call(openGuidedReviewThreadContract, { ...sessionAddress(session), body: input }),
    getGuidedReviewThread: (session: GuidedReviewSession, threadId: string) =>
      call(getGuidedReviewThreadContract, {
        ...sessionAddress(session),
        pathParams: { sessionId: session.id, threadId },
      }),
    askGuidedReview: (
      session: GuidedReviewSession,
      threadId: string,
      input: AskGuidedReviewInput,
    ) =>
      call(askGuidedReviewContract, {
        ...sessionAddress(session),
        pathParams: { sessionId: session.id, threadId },
        body: input,
      }),
    requestGuidedReviewDrafts: (
      session: GuidedReviewSession,
      threadId: string,
      instructions: string,
    ) =>
      call(requestGuidedReviewDraftsContract, {
        ...sessionAddress(session),
        pathParams: { sessionId: session.id, threadId },
        body: instructions.length > 0 ? { instructions } : {},
      }),
    editGuidedReviewDraft: (
      session: GuidedReviewSession,
      draftId: string,
      input: EditGuidedReviewDraftInput,
    ) =>
      call(editGuidedReviewDraftContract, {
        ...sessionAddress(session),
        pathParams: { sessionId: session.id, draftId },
        body: input,
      }),
    /** Posts on the pull request. The answer reports every named draft, posted or not. */
    postGuidedReviewDrafts: (session: GuidedReviewSession, draftIds: string[], summary: string) =>
      call(postGuidedReviewDraftsContract, {
        ...sessionAddress(session),
        body: summary.length > 0 ? { draftIds, summary } : { draftIds },
      }),
  }
}
