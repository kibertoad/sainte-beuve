import { CatFactoryClient, CatFactoryNotFoundError } from '@cat-factory/sdk'
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
  withDeadline,
} from '@sainte-beuve/kernel'
import { type DirectoryLocation, locationOf } from './directoryKeys.js'
import { refusalFor } from './refusals.js'
import { WorkspaceClients } from './workspaceClients.js'

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

/** Where a session lives: a named workspace, or null for the key's only one. */
type Workspace = string | null

/**
 * The workspaces a set of mirror keys names, each once and in id order, so the
 * same keys always pick the same workspace first. No keys names the key's only
 * workspace, the one a deployment without a mirror calls.
 */
function workspacesOf(directoryKeys: readonly string[]): Workspace[] {
  const ids = directoryKeys
    .map(locationOf)
    .filter((location): location is DirectoryLocation => location !== null)
    .map((location) => location.workspaceId)
  const distinct = [...new Set(ids)].toSorted()
  return distinct.length === 0 ? [null] : distinct
}

/**
 * Ask every workspace at once and settle on the first, in the order given, that
 * found something: a session lives in exactly one, so its answer settles where.
 * A refusal is passed on only when no workspace found anything, because reading
 * it as absence could open a second session beside the one it hid.
 */
async function firstFound<T>(
  workspaces: readonly Workspace[],
  lookup: (workspace: Workspace) => Promise<T | null>,
): Promise<{ workspace: Workspace; found: T } | null> {
  const settled = await Promise.allSettled(workspaces.map(lookup))
  for (const [index, answer] of settled.entries()) {
    if (answer.status === 'fulfilled' && answer.value !== null) {
      return { workspace: workspaces[index] ?? null, found: answer.value }
    }
  }
  const refused = settled.find((answer) => answer.status === 'rejected')
  if (refused !== undefined) throw refused.reason
  return null
}

/**
 * The cat-factory side of the guided-review port.
 *
 * A thin relay on purpose. The SDK's operations and models are generated from
 * cat-factory's OpenAPI spec, and the shapes this port answers with are
 * cat-factory's own schemas, so there is nothing to translate except a refusal
 * and the workspace a call has to name.
 *
 * A call names the workspace its repository's mirror keys point at, with no
 * read first when they point at one. Only a repository linked in several makes
 * a call read the session in each. Built per request, the gateway remembers
 * that answer, so the tenancy read and the call after it look once.
 */
export class CatFactoryGuidedReviewGateway implements GuidedReviewGateway {
  private readonly clients: WorkspaceClients
  /**
   * The same key without the transport deadline, for the stream alone. A
   * deadline aborts the body as well as the connect, so the shared one would
   * cut every stream at twenty seconds. cat-factory caps the stream's length
   * itself, and the reader aborts it on leaving.
   */
  private readonly streaming: WorkspaceClients
  private readonly sessionWorkspaces = new Map<string, Workspace>()

  constructor(options: CatFactoryGuidedReviewOptions) {
    const { baseUrl, apiKey, fetch } = options
    const shared = (workspaceId: string | undefined) => ({
      baseUrl,
      apiKey,
      userAgent: 'sainte-beuve',
      ...(workspaceId === undefined ? {} : { workspaceId }),
    })
    this.clients = new WorkspaceClients(
      (workspaceId) => new CatFactoryClient({ ...shared(workspaceId), fetch: withDeadline(fetch) }),
    )
    this.streaming = new WorkspaceClients(
      (workspaceId) =>
        new CatFactoryClient({ ...shared(workspaceId), timeoutMs: 0, ...(fetch ? { fetch } : {}) }),
    )
  }

  /**
   * cat-factory lists sessions by its own repository id, which nothing here
   * holds, so the lookup narrows by pull request number and matches the
   * repository on the rows, in each workspace that links the repository. `mine`
   * keeps it to sessions this key owns: any other is one this deployment could
   * read but never ask anything of.
   */
  async find(
    target: GuidedReviewTarget,
    directoryKeys: readonly string[],
  ): Promise<GuidedReviewSessionView | null> {
    const sessionId = await this.findIn(workspacesOf(directoryKeys), target)
    return sessionId === null ? null : this.get({ sessionId, directoryKeys })
  }

  /**
   * Open in the first workspace linking the repository. With several linking
   * it, a session already open in any of them is answered instead, because
   * cat-factory only returns the existing session of the workspace it is asked
   * in, and a second one would split the review's threads in two.
   */
  async open(
    target: GuidedReviewTarget,
    directoryKeys: readonly string[],
  ): Promise<GuidedReviewSessionView> {
    const workspaces = workspacesOf(directoryKeys)
    if (workspaces.length > 1) {
      const sessionId = await this.findIn(workspaces, target)
      if (sessionId !== null) return this.get({ sessionId, directoryKeys })
    }
    const workspace = workspaces[0] ?? null
    const { provider, owner, repo, number } = target
    const view = await this.relay(`open a guided review of ${owner}/${repo}#${number}`, () =>
      this.clients.in(workspace).guidedReviews.open({ provider, owner, repo, prNumber: number }),
    )
    this.sessionWorkspaces.set(view.session.id, workspace)
    return view
  }

  async get(session: GuidedReviewSessionRef): Promise<GuidedReviewSessionView> {
    const { sessionId } = session
    const located = await this.locate(session)
    if (located.view !== null) return located.view
    return this.relay(`read guided review ${sessionId}`, () =>
      this.clients.in(located.workspace).guidedReviews.get(sessionId),
    )
  }

  async refresh(session: GuidedReviewSessionRef): Promise<GuidedReviewSessionView> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`refresh guided review ${sessionId}`, () =>
      client.guidedReviews.refresh(sessionId),
    )
  }

  async openThread(
    session: GuidedReviewSessionRef,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`open a thread on guided review ${sessionId}`, () =>
      client.guidedReviews.openThread(sessionId, input),
    )
  }

  async getThread(
    session: GuidedReviewSessionRef,
    threadId: string,
  ): Promise<GuidedReviewThreadView> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`read thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.getThread(sessionId, threadId),
    )
  }

  async ask(
    session: GuidedReviewSessionRef,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`ask in thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.ask(sessionId, threadId, input),
    )
  }

  async requestDrafts(
    session: GuidedReviewSessionRef,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`draft comments from thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.requestDrafts(sessionId, threadId, input),
    )
  }

  async editDraft(
    session: GuidedReviewSessionRef,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`edit draft ${draftId} of guided review ${sessionId}`, () =>
      client.guidedReviews.editDraft(sessionId, draftId, input),
    )
  }

  async postDrafts(
    session: GuidedReviewSessionRef,
    input: PostGuidedReviewDraftsInput,
  ): Promise<GuidedReviewPostResult> {
    const { sessionId } = session
    const client = await this.clientOf(session)
    return this.relay(`post the comment drafts of guided review ${sessionId}`, () =>
      client.guidedReviews.postDrafts(sessionId, input),
    )
  }

  async *watch(
    session: GuidedReviewSessionRef,
    signal: AbortSignal,
  ): AsyncGenerator<GuidedReviewWatchEvent> {
    const { sessionId } = session
    const streaming = this.streaming.in((await this.locate(session)).workspace)
    const stream = await this.relay(`stream guided review ${sessionId}`, () =>
      streaming.guidedReviews.stream(sessionId, { signal, timeoutMs: 0 }),
    )
    try {
      for await (const frame of stream) {
        const event = watchEventOf(frame.event, () => frame.json())
        if (event !== null) yield event
        if (event?.kind === 'deleted' || event?.kind === 'timeout') return
      }
    } finally {
      await stream.close()
    }
  }

  /** The id of this key's session for the target in the first workspace holding one. */
  private async findIn(
    workspaces: readonly Workspace[],
    target: GuidedReviewTarget,
  ): Promise<string | null> {
    const hit = await firstFound(workspaces, (workspace) =>
      this.relay(`look up the guided review of #${target.number}`, async () => {
        for await (const row of this.clients.in(workspace).guidedReviews.listAll({
          prNumber: target.number,
          mine: 'true',
        })) {
          if (isGuidedReviewFor(row, target)) return row.id
        }
        return null
      }),
    )
    if (hit === null) return null
    this.sessionWorkspaces.set(hit.found, hit.workspace)
    return hit.found
  }

  private async clientOf(session: GuidedReviewSessionRef): Promise<CatFactoryClient> {
    return this.clients.in((await this.locate(session)).workspace)
  }

  /**
   * The workspace holding a session, and its view when finding it meant reading
   * it. One linking workspace is named without a read. With several, the
   * session is read in each: cat-factory answers 404 everywhere but the
   * workspace that holds it.
   */
  private async locate(
    session: GuidedReviewSessionRef,
  ): Promise<{ workspace: Workspace; view: GuidedReviewSessionView | null }> {
    const { sessionId } = session
    const known = this.sessionWorkspaces.get(sessionId)
    if (known !== undefined) return { workspace: known, view: null }
    const candidates = workspacesOf(session.directoryKeys)
    if (candidates.length === 1) return { workspace: candidates[0] ?? null, view: null }
    const hit = await firstFound(candidates, (workspace) => this.readIn(workspace, sessionId))
    if (hit === null) {
      throw new NotFoundError(
        `cat-factory has no guided review ${sessionId} in any workspace that links its repository`,
        { upstream: 'cat-factory' },
      )
    }
    this.sessionWorkspaces.set(sessionId, hit.workspace)
    return { workspace: hit.workspace, view: hit.found }
  }

  /** The session as one workspace holds it, or null where cat-factory answers 404. */
  private async readIn(
    workspace: Workspace,
    sessionId: string,
  ): Promise<GuidedReviewSessionView | null> {
    try {
      return await this.clients.in(workspace).guidedReviews.get(sessionId)
    } catch (err) {
      if (err instanceof CatFactoryNotFoundError) return null
      throw refusalFor(err, `read guided review ${sessionId}`, 'write')
    }
  }

  private async relay<T>(what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (err) {
      throw refusalFor(err, what, 'write')
    }
  }
}

/**
 * One upstream frame as the port's event, or null for one this deployment has
 * no use for (a keep-alive, or a kind cat-factory adds later).
 */
function watchEventOf(name: string, json: () => unknown): GuidedReviewWatchEvent | null {
  if (name === 'deleted' || name === 'timeout') return { kind: name }
  if (name !== 'state') return null
  // The SDK decodes the frame; its shape is the session view `get` answers with.
  const view = json() as GuidedReviewSessionView | null
  return view === null ? null : { kind: 'state', view }
}
