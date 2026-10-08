import type {
  AskGuidedReviewInput,
  GuidedReviewExchange,
  GuidedReviewSessionView,
  GuidedReviewTarget,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  RequestGuidedReviewDraftsInput,
} from '@sainte-beuve/contracts'
import { type GuidedReviewGateway, NotFoundError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveGuidedReview } from '../../integrations/resolve.js'

const NOT_CONFIGURED =
  'cat-factory is not configured for this deployment: a guided review needs a base URL and an ' +
  'API key with the `write` scope (the key can be entered on the Configuration screen)'

/**
 * cat-factory's guided review, relayed for one org.
 *
 * cat-factory owns the sessions and this deployment stores nothing about them.
 * What it adds is the tenancy: one cat-factory key can serve several orgs, so
 * every session is checked against this org's registered projects before
 * anything about it is answered or done to it. A session id from another org's
 * screen reads as not found, the same as one that does not exist.
 */
export class GuidedReviewService {
  private resolved: Promise<GuidedReviewGateway> | null = null

  constructor(private readonly container: AppContainer) {}

  async find(target: GuidedReviewTarget): Promise<GuidedReviewSessionView | null> {
    await this.assertRegistered(target)
    return (await this.gateway()).find(target)
  }

  async open(target: GuidedReviewTarget): Promise<GuidedReviewSessionView> {
    await this.assertRegistered(target)
    return (await this.gateway()).open(target)
  }

  async get(sessionId: string): Promise<GuidedReviewSessionView> {
    const view = await (await this.gateway()).get(sessionId)
    const { provider, owner, repo, prNumber } = view.session
    await this.assertRegistered({ provider, owner, repo, number: prNumber }, sessionId)
    return view
  }

  async refresh(sessionId: string): Promise<GuidedReviewSessionView> {
    await this.get(sessionId)
    return (await this.gateway()).refresh(sessionId)
  }

  async openThread(
    sessionId: string,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView> {
    await this.get(sessionId)
    return (await this.gateway()).openThread(sessionId, input)
  }

  async getThread(sessionId: string, threadId: string): Promise<GuidedReviewThreadView> {
    await this.get(sessionId)
    return (await this.gateway()).getThread(sessionId, threadId)
  }

  async ask(
    sessionId: string,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange> {
    await this.get(sessionId)
    return (await this.gateway()).ask(sessionId, threadId, input)
  }

  async requestDrafts(
    sessionId: string,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange> {
    await this.get(sessionId)
    return (await this.gateway()).requestDrafts(sessionId, threadId, input)
  }

  /**
   * Refuse a pull request in a repository this org has not registered.
   *
   * Named by the session when there is one, so a foreign session id says no
   * more than a missing one would.
   */
  private async assertRegistered(target: GuidedReviewTarget, sessionId?: string): Promise<void> {
    const project = await this.container.repositories.projects.getByRef(target)
    if (project !== null) return
    throw new NotFoundError(
      sessionId === undefined
        ? `${target.owner}/${target.repo} is not a registered project`
        : `No guided review ${sessionId}`,
    )
  }

  /** Resolved once per request: a stored key is a credential read and a decryption. */
  private gateway(): Promise<GuidedReviewGateway> {
    this.resolved ??= resolveGuidedReview(this.container).then(
      (resolved) => requireCapability(resolved, NOT_CONFIGURED).gateway,
    )
    return this.resolved
  }
}
