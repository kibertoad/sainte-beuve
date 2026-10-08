import { CatFactoryClient } from '@cat-factory/sdk'
import type {
  AskGuidedReviewInput,
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewExchange,
  GuidedReviewPostResult,
  GuidedReviewSession,
  GuidedReviewSessionView,
  GuidedReviewTarget,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  PostGuidedReviewDraftsInput,
  RequestGuidedReviewDraftsInput,
} from '@sainte-beuve/contracts'
import { type GuidedReviewGateway, withDeadline } from '@sainte-beuve/kernel'
import { refusalFor } from './refusals.js'

export interface CatFactoryGuidedReviewOptions {
  /** Origin of the cat-factory instance, e.g. `http://localhost:8787` for a local one. */
  baseUrl: string
  /**
   * A cat-factory public-API key. `write` is enough: opening, asking and
   * drafting spend model budget and post nothing. A key bound to nobody owns its
   * own sessions and runs on the cat-factory workspace's credentials.
   */
  apiKey: string
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/** Whether a session is about the pull request a target names. Hosts compare names caselessly. */
function isFor(session: GuidedReviewSession, target: GuidedReviewTarget): boolean {
  return (
    session.provider === target.provider &&
    session.prNumber === target.number &&
    session.owner.toLowerCase() === target.owner.toLowerCase() &&
    session.repo.toLowerCase() === target.repo.toLowerCase()
  )
}

/**
 * The cat-factory side of the guided-review port.
 *
 * A thin relay on purpose. The SDK's operations and models are generated from
 * cat-factory's OpenAPI spec, and the shapes this port answers with are
 * cat-factory's own schemas, so there is nothing to translate except a refusal.
 */
export class CatFactoryGuidedReviewGateway implements GuidedReviewGateway {
  private readonly client: CatFactoryClient

  constructor(options: CatFactoryGuidedReviewOptions) {
    this.client = new CatFactoryClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userAgent: 'sainte-beuve',
      fetch: withDeadline(options.fetch),
    })
  }

  /**
   * cat-factory lists sessions by its own repository id, which nothing here
   * holds, so the lookup narrows by pull request number and matches the
   * repository on the rows. `mine` keeps it to sessions this key owns: any
   * other is one this deployment could read but never ask anything of.
   */
  async find(target: GuidedReviewTarget): Promise<GuidedReviewSessionView | null> {
    const session = await this.relay(`look up the guided review of #${target.number}`, async () => {
      for await (const row of this.client.guidedReviews.listAll({
        prNumber: target.number,
        mine: 'true',
      })) {
        if (isFor(row, target)) return row
      }
      return null
    })
    return session === null ? null : this.get(session.id)
  }

  open(target: GuidedReviewTarget): Promise<GuidedReviewSessionView> {
    const { provider, owner, repo, number } = target
    return this.relay(`open a guided review of ${owner}/${repo}#${number}`, () =>
      this.client.guidedReviews.open({ provider, owner, repo, prNumber: number }),
    )
  }

  get(sessionId: string): Promise<GuidedReviewSessionView> {
    return this.relay(`read guided review ${sessionId}`, () =>
      this.client.guidedReviews.get(sessionId),
    )
  }

  refresh(sessionId: string): Promise<GuidedReviewSessionView> {
    return this.relay(`refresh guided review ${sessionId}`, () =>
      this.client.guidedReviews.refresh(sessionId),
    )
  }

  openThread(
    sessionId: string,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView> {
    return this.relay(`open a thread on guided review ${sessionId}`, () =>
      this.client.guidedReviews.openThread(sessionId, input),
    )
  }

  getThread(sessionId: string, threadId: string): Promise<GuidedReviewThreadView> {
    return this.relay(`read thread ${threadId} of guided review ${sessionId}`, () =>
      this.client.guidedReviews.getThread(sessionId, threadId),
    )
  }

  ask(
    sessionId: string,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange> {
    return this.relay(`ask in thread ${threadId} of guided review ${sessionId}`, () =>
      this.client.guidedReviews.ask(sessionId, threadId, input),
    )
  }

  requestDrafts(
    sessionId: string,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange> {
    return this.relay(`draft comments from thread ${threadId} of guided review ${sessionId}`, () =>
      this.client.guidedReviews.requestDrafts(sessionId, threadId, input),
    )
  }

  editDraft(
    sessionId: string,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft> {
    return this.relay(`edit draft ${draftId} of guided review ${sessionId}`, () =>
      this.client.guidedReviews.editDraft(sessionId, draftId, input),
    )
  }

  postDrafts(
    sessionId: string,
    input: PostGuidedReviewDraftsInput,
  ): Promise<GuidedReviewPostResult> {
    return this.relay(`post the comment drafts of guided review ${sessionId}`, () =>
      this.client.guidedReviews.postDrafts(sessionId, input),
    )
  }

  private async relay<T>(what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (err) {
      throw refusalFor(err, what, 'write')
    }
  }
}
