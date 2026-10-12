import { CatFactoryClient, CatFactoryNotFoundError } from '@cat-factory/sdk'
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
import {
  type GuidedReviewGateway,
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
  /**
   * Every key the org's repository mirror holds, read when a call by session id
   * has to find the session's workspace. Absent, every such call goes to the
   * key's only workspace.
   */
  directoryKeys?: () => Promise<readonly string[]>
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/** Where a session lives: a named workspace, or null for the key's only one. */
type Workspace = string | null

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
 * The cat-factory side of the guided-review port.
 *
 * A thin relay on purpose. The SDK's operations and models are generated from
 * cat-factory's OpenAPI spec, and the shapes this port answers with are
 * cat-factory's own schemas, so there is nothing to translate except a refusal
 * and the workspace a call has to name.
 *
 * Built per request, so what it learns about where a session lives lasts one
 * request: the tenancy check reads the session first, and the call after it
 * reuses the workspace that read found.
 */
export class CatFactoryGuidedReviewGateway implements GuidedReviewGateway {
  private readonly directoryKeys: CatFactoryGuidedReviewOptions['directoryKeys']
  private readonly clients: WorkspaceClients
  /**
   * The same key without the transport deadline, for the stream alone. A
   * deadline aborts the body as well as the connect, so the shared one would
   * cut every stream at twenty seconds. cat-factory caps the stream's length
   * itself, and the reader aborts it on leaving.
   */
  private readonly streaming: WorkspaceClients
  private readonly sessionWorkspaces = new Map<string, Workspace>()
  private orgWorkspaces: Promise<Workspace[]> | null = null

  constructor(options: CatFactoryGuidedReviewOptions) {
    const { baseUrl, apiKey, fetch } = options
    this.directoryKeys = options.directoryKeys
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
    return sessionId === null ? null : this.get(sessionId)
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
      const existing = await this.findIn(workspaces, target)
      if (existing !== null) return this.get(existing)
    }
    const workspace = workspaces[0] ?? null
    const { provider, owner, repo, number } = target
    const view = await this.relay(`open a guided review of ${owner}/${repo}#${number}`, () =>
      this.clients.in(workspace).guidedReviews.open({
        provider,
        owner,
        repo,
        prNumber: number,
      }),
    )
    this.sessionWorkspaces.set(view.session.id, workspace)
    return view
  }

  async get(sessionId: string): Promise<GuidedReviewSessionView> {
    const located = await this.locate(sessionId)
    if (located.view !== null) return located.view
    return this.relay(`read guided review ${sessionId}`, () =>
      this.clients.in(located.workspace).guidedReviews.get(sessionId),
    )
  }

  async refresh(sessionId: string): Promise<GuidedReviewSessionView> {
    const client = await this.clientOf(sessionId)
    return this.relay(`refresh guided review ${sessionId}`, () =>
      client.guidedReviews.refresh(sessionId),
    )
  }

  async openThread(
    sessionId: string,
    input: OpenGuidedReviewThreadInput,
  ): Promise<GuidedReviewThreadView> {
    const client = await this.clientOf(sessionId)
    return this.relay(`open a thread on guided review ${sessionId}`, () =>
      client.guidedReviews.openThread(sessionId, input),
    )
  }

  async getThread(sessionId: string, threadId: string): Promise<GuidedReviewThreadView> {
    const client = await this.clientOf(sessionId)
    return this.relay(`read thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.getThread(sessionId, threadId),
    )
  }

  async ask(
    sessionId: string,
    threadId: string,
    input: AskGuidedReviewInput,
  ): Promise<GuidedReviewExchange> {
    const client = await this.clientOf(sessionId)
    return this.relay(`ask in thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.ask(sessionId, threadId, input),
    )
  }

  async requestDrafts(
    sessionId: string,
    threadId: string,
    input: RequestGuidedReviewDraftsInput,
  ): Promise<GuidedReviewExchange> {
    const client = await this.clientOf(sessionId)
    return this.relay(`draft comments from thread ${threadId} of guided review ${sessionId}`, () =>
      client.guidedReviews.requestDrafts(sessionId, threadId, input),
    )
  }

  async editDraft(
    sessionId: string,
    draftId: string,
    input: EditGuidedReviewDraftInput,
  ): Promise<GuidedReviewCommentDraft> {
    const client = await this.clientOf(sessionId)
    return this.relay(`edit draft ${draftId} of guided review ${sessionId}`, () =>
      client.guidedReviews.editDraft(sessionId, draftId, input),
    )
  }

  async postDrafts(
    sessionId: string,
    input: PostGuidedReviewDraftsInput,
  ): Promise<GuidedReviewPostResult> {
    const client = await this.clientOf(sessionId)
    return this.relay(`post the comment drafts of guided review ${sessionId}`, () =>
      client.guidedReviews.postDrafts(sessionId, input),
    )
  }

  async *watch(sessionId: string, signal: AbortSignal): AsyncGenerator<GuidedReviewWatchEvent> {
    const streaming = this.streaming.in((await this.locate(sessionId)).workspace)
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
    const sessions = await Promise.all(
      workspaces.map((workspace) =>
        this.relay(`look up the guided review of #${target.number}`, async () => {
          for await (const row of this.clients.in(workspace).guidedReviews.listAll({
            prNumber: target.number,
            mine: 'true',
          })) {
            if (isFor(row, target)) return row
          }
          return null
        }),
      ),
    )
    const index = sessions.findIndex((session) => session !== null)
    const session = sessions[index]
    if (session === undefined || session === null) return null
    this.sessionWorkspaces.set(session.id, workspaces[index] ?? null)
    return session.id
  }

  private async clientOf(sessionId: string): Promise<CatFactoryClient> {
    return this.clients.in((await this.locate(sessionId)).workspace)
  }

  /**
   * The workspace holding a session, and its view when finding it meant reading
   * it. One candidate is named without a read. With several, the session is read
   * in each: cat-factory answers 404 everywhere but the workspace that holds it,
   * and any other refusal is passed through rather than read as absence.
   */
  private async locate(
    sessionId: string,
  ): Promise<{ workspace: Workspace; view: GuidedReviewSessionView | null }> {
    const known = this.sessionWorkspaces.get(sessionId)
    if (known !== undefined) return { workspace: known, view: null }
    const candidates = await this.candidateWorkspaces()
    if (candidates.length === 1) return { workspace: candidates[0] ?? null, view: null }
    const reads = await Promise.all(
      candidates.map((workspace) => this.readIn(workspace, sessionId)),
    )
    const found = reads.find((read) => read !== null)
    if (found === undefined) {
      throw new NotFoundError(
        `cat-factory has no guided review ${sessionId} in any workspace this org's repositories are linked in`,
        { upstream: 'cat-factory' },
      )
    }
    this.sessionWorkspaces.set(sessionId, found.workspace)
    return found
  }

  private async readIn(
    workspace: Workspace,
    sessionId: string,
  ): Promise<{ workspace: Workspace; view: GuidedReviewSessionView } | null> {
    try {
      return {
        workspace,
        view: await this.clients.in(workspace).guidedReviews.get(sessionId),
      }
    } catch (err) {
      if (err instanceof CatFactoryNotFoundError) return null
      throw refusalFor(err, `read guided review ${sessionId}`, 'write')
    }
  }

  private candidateWorkspaces(): Promise<Workspace[]> {
    const read = this.directoryKeys
    this.orgWorkspaces ??= read === undefined ? Promise.resolve([null]) : read().then(workspacesOf)
    return this.orgWorkspaces
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
