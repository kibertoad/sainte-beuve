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
 * refused a call that names none. Every call carries the keys the org's
 * repository mirror holds the pull request's repository under, one per
 * workspace linking it, and the gateway reads the workspace out of those.
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
  get(session: GuidedReviewSessionRef): Promise<GuidedReviewSessionView>
  /** Regenerate the overview at the pull request's current head. */
  refresh(session: GuidedReviewSessionRef): Promise<GuidedReviewSessionView>
  openThread(
    session: GuidedReviewSessionRef,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView>
  getThread(session: GuidedReviewSessionRef, threadId: string): Promise<GuidedReviewThreadView>
  ask(
    session: GuidedReviewSessionRef,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange>
  requestDrafts(
    session: GuidedReviewSessionRef,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange>
  editDraft(
    session: GuidedReviewSessionRef,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft>
  postDrafts(
    session: GuidedReviewSessionRef,
    input: PostGuidedReviewDraftsInput,
  ): Promise<GuidedReviewPostResult>
  /**
   * The session's changes as cat-factory pushes them, until it caps the
   * connection or `signal` aborts. Rejects on the first iteration if the stream
   * cannot be opened.
   */
  watch(session: GuidedReviewSessionRef, signal: AbortSignal): AsyncIterable<GuidedReviewWatchEvent>
}

/**
 * A session, and the mirror keys of its pull request's repository, which name
 * the workspaces it can live in. No keys names the key's only workspace.
 */
export interface GuidedReviewSessionRef {
  sessionId: string
  directoryKeys: readonly string[]
}
