import type {
  AskGuidedReviewInput,
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewExchange,
  GuidedReviewPostResult,
  GuidedReviewSessionView,
  GuidedReviewStreamEvent,
  GuidedReviewTarget,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  PostGuidedReviewDraftsInput,
  RequestGuidedReviewDraftsInput,
} from '@sainte-beuve/contracts'
import type { CatFactoryAccess } from './gateways.js'

/**
 * What a guided review's upstream stream yields: the frames a screen receives,
 * and `timeout` when cat-factory capped the connection and expects a reconnect.
 */
export type GuidedReviewWatchEvent = GuidedReviewStreamEvent | { kind: 'timeout' }

/**
 * cat-factory's guided review of one pull request, over the published SDK.
 *
 * Every session belongs to the API key this deployment holds, so a pull request
 * has ONE guided review per deployment, shared by everybody who opens it. That
 * is the board's model too: a review row is the team's, not one person's.
 *
 * Every write resolves with what cat-factory persisted, before the overview or
 * the answer exists. The caller re-reads until nothing is pending. Posting
 * drafts is the one call that reaches the pull request, and it posts on the
 * cat-factory workspace's credentials, because the key belongs to no person.
 *
 * A session lives in one cat-factory workspace, and a key reaching several is
 * refused a call that names none. `find` and `open` take the keys the org's
 * repository mirror holds the pull request's repository under, one per
 * workspace linking it; a call by session id is made in the workspace that
 * holds the session.
 */
export interface GuidedReviewGateway {
  /** The session this deployment holds for a pull request, or null. Spends nothing. */
  find(
    target: GuidedReviewTarget,
    directoryKeys: readonly string[],
  ): Promise<GuidedReviewSessionView | null>
  /** Open a session, or answer with the one already open. Spends model budget when new. */
  open(
    target: GuidedReviewTarget,
    directoryKeys: readonly string[],
  ): Promise<GuidedReviewSessionView>
  get(sessionId: string): Promise<GuidedReviewSessionView>
  /** Regenerate the overview at the pull request's current head. */
  refresh(sessionId: string): Promise<GuidedReviewSessionView>
  openThread(sessionId: string, input: OpenGuidedReviewThreadInput): Promise<GuidedReviewThreadView>
  getThread(sessionId: string, threadId: string): Promise<GuidedReviewThreadView>
  ask(
    sessionId: string,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange>
  requestDrafts(
    sessionId: string,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange>
  editDraft(
    sessionId: string,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft>
  postDrafts(sessionId: string, input: PostGuidedReviewDraftsInput): Promise<GuidedReviewPostResult>
  /**
   * The session's changes as cat-factory pushes them, until it caps the
   * connection or `signal` aborts. Rejects on the first iteration if the stream
   * cannot be opened.
   */
  watch(sessionId: string, signal: AbortSignal): AsyncIterable<GuidedReviewWatchEvent>
}

/** What the guided reviewer needs on top of access: where its sessions can live. */
export interface CatFactoryGuidedReviewAccess extends CatFactoryAccess {
  /**
   * Every key the org's repository mirror holds, across all its workspaces,
   * read only when a call by session id needs to find the session's workspace.
   */
  directoryKeys: () => Promise<readonly string[]>
}
