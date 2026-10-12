import type {
  AskGuidedReviewInput,
  EditGuidedReviewDraftInput,
  GuidedReviewCommentDraft,
  GuidedReviewExchange,
  GuidedReviewPostResult,
  GuidedReviewSessionView,
  GuidedReviewTarget,
  GuidedReviewThreadView,
  OpenGuidedReviewThreadInput,
  PostGuidedReviewDraftsInput,
  RequestGuidedReviewDraftsInput,
} from '@sainte-beuve/contracts'
import { isGuidedReviewFor } from '@sainte-beuve/contracts'
import {
  type GuidedReviewGateway,
  type GuidedReviewSessionRef,
  type GuidedReviewWatchEvent,
  NotFoundError,
} from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { catFactoryDirectoryKeys } from '../projects/directoryKeys.js'
import { resolveGuidedReview } from '../../integrations/resolve.js'

/** A call about one session: its id, and the pull request the caller says it is about. */
export interface GuidedReviewAddress {
  sessionId: string
  target: GuidedReviewTarget
}

interface CheckedSession {
  gateway: GuidedReviewGateway
  session: GuidedReviewSessionRef
  view: GuidedReviewSessionView
}

export interface GuidedReviewWatch {
  initial: GuidedReviewSessionView
  events: (signal: AbortSignal) => AsyncIterable<GuidedReviewWatchEvent>
}

const NOT_CONFIGURED =
  'cat-factory is not configured for this org: a guided review needs its base URL and an API ' +
  'key with the `write` scope, which an admin sets on the Configuration screen'

/**
 * cat-factory's guided review, relayed for one org.
 *
 * cat-factory owns the sessions and this deployment stores nothing about them.
 * What it adds is the tenancy: one cat-factory key can serve several orgs, so
 * every session is checked against this org's registered projects before
 * anything about it is answered or done to it. A call about a session names
 * its pull request too: the repository is what the check reads, and what says
 * which cat-factory workspace holds the session. A session id from another
 * org's screen, or named with a pull request it is not about, reads as not
 * found, the same as one that does not exist.
 */
export class GuidedReviewService {
  private resolved: Promise<GuidedReviewGateway> | null = null

  constructor(private readonly container: AppContainer) {}

  async find(target: GuidedReviewTarget): Promise<GuidedReviewSessionView | null> {
    await this.assertRegistered(target)
    const [gateway, keys] = await Promise.all([
      this.gateway(),
      catFactoryDirectoryKeys(this.container, target),
    ])
    return gateway.find(target, keys)
  }

  async open(target: GuidedReviewTarget): Promise<GuidedReviewSessionView> {
    await this.assertRegistered(target)
    const [gateway, keys] = await Promise.all([
      this.gateway(),
      catFactoryDirectoryKeys(this.container, target),
    ])
    return gateway.open(target, keys)
  }

  async get(address: GuidedReviewAddress): Promise<GuidedReviewSessionView> {
    return (await this.checked(address)).view
  }

  async refresh(address: GuidedReviewAddress): Promise<GuidedReviewSessionView> {
    const { gateway, session } = await this.checked(address)
    return gateway.refresh(session)
  }

  async openThread(
    address: GuidedReviewAddress,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView> {
    const { gateway, session } = await this.checked(address)
    return gateway.openThread(session, input)
  }

  async getThread(address: GuidedReviewAddress, threadId: string): Promise<GuidedReviewThreadView> {
    const { gateway, session } = await this.checked(address)
    return gateway.getThread(session, threadId)
  }

  async ask(
    address: GuidedReviewAddress,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange> {
    const { gateway, session } = await this.checked(address)
    return gateway.ask(session, threadId, input)
  }

  async requestDrafts(
    address: GuidedReviewAddress,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange> {
    const { gateway, session } = await this.checked(address)
    return gateway.requestDrafts(session, threadId, input)
  }

  async editDraft(
    address: GuidedReviewAddress,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft> {
    const { gateway, session } = await this.checked(address)
    return gateway.editDraft(session, draftId, input)
  }

  async postDrafts(
    address: GuidedReviewAddress,
    input: PostGuidedReviewDraftsInput,
  ): Promise<GuidedReviewPostResult> {
    const { gateway, session } = await this.checked(address)
    return gateway.postDrafts(session, input)
  }

  /**
   * The session as it stands, checked against this org once, and its changes
   * as cat-factory pushes them. The check happens before the stream is
   * answered, so a foreign session is a 404 rather than an empty stream.
   */
  async watch(address: GuidedReviewAddress): Promise<GuidedReviewWatch> {
    const { gateway, session, view } = await this.checked(address)
    return { initial: view, events: (signal) => gateway.watch(session, signal) }
  }

  /**
   * Read a session and refuse it unless it is about the pull request the call
   * named, in a repository this org holds the claim on. The repository's mirror
   * keys say which workspace to read it in, and the call after it reuses them.
   */
  private async checked(address: GuidedReviewAddress): Promise<CheckedSession> {
    const { sessionId, target } = address
    await this.assertRegistered(target, sessionId)
    const [gateway, directoryKeys] = await Promise.all([
      this.gateway(),
      catFactoryDirectoryKeys(this.container, target),
    ])
    const session = { sessionId, directoryKeys }
    const view = await gateway.get(session)
    if (!isGuidedReviewFor(view.session, target))
      throw new NotFoundError(`No guided review ${sessionId}`)
    return { gateway, session, view }
  }

  /**
   * Refuse a pull request in a repository this org does not hold the claim on.
   *
   * The claim, not merely a registration: sessions belong to the cat-factory
   * key, so two orgs holding one repository would otherwise share its sessions.
   * The oldest claim is the one webhook intake follows, and it is the one that
   * answers here. Named by the session when there is one, so a foreign session
   * id says no more than a missing one would.
   */
  private async assertRegistered(target: GuidedReviewTarget, sessionId?: string): Promise<void> {
    const holder = await this.container.stores.tenancy.findOrgIdForProject(target)
    if (holder === this.container.orgId) return
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
