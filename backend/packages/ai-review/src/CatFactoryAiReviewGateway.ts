import {
  CatFactoryClient,
  CatFactoryNotFoundError,
  type CreatePublicTask,
  type PublicRun,
} from '@cat-factory/sdk'
import type { AiReviewCuration, AiReviewResolution } from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  type AiReviewHandle,
  type AiReviewReport,
  type CatFactoryPlacementTarget,
  formatPullRequest,
  withDeadline,
} from '@sainte-beuve/kernel'
import { appUrlOf } from './catFactoryApp.js'
import { curationOf } from './curation.js'
import { placeTask } from './placement.js'
import { refusalFor } from './refusals.js'
import { WorkspaceClients } from './workspaceClients.js'

/**
 * The cat-factory side of the AI-review port.
 *
 * sainte-beuve runs no models. It files a `review` task against a cat-factory
 * service and drives the run, which is why this package depends on the PUBLISHED
 * `@cat-factory/sdk` rather than reimplementing the wire format: the SDK's
 * operations are generated from cat-factory's own OpenAPI spec, so a deployment
 * bumping cat-factory cannot silently drift from what we send.
 *
 * The instance is per deployment. A developer points `baseUrl` at their own local
 * cat-factory; a hosted sainte-beuve points it at the org's centralized one. Nothing
 * in this class assumes either.
 */
export interface CatFactoryOptions {
  /** Origin of the cat-factory instance, e.g. `http://localhost:8787` for a local one. */
  baseUrl: string
  /**
   * Origin of its web app, when it is served apart from the API. The links into
   * cat-factory use it; null asks the instance, then falls back to `baseUrl`.
   */
  appUrl?: string | null
  /** Sent as `X-Personal-Password` on every call, for a key bound to the person it acts for. */
  personalPassword?: string | null
  /**
   * A cat-factory public-API key: `cf_live_<keyId>.<secret>`. It needs the
   * `decide` scope rather than just `write`: a `review` task PARKS on its
   * findings, and cat-factory refuses to start a run that the calling key could
   * not then answer. The refusal names the scope, and it arrives when the review
   * is filed, which is where this deployment reports it.
   */
  apiKey: string
  /**
   * The service (repository frame) a review task goes under when no service
   * backs its repository. cat-factory models one service per repository, so a
   * review normally goes under its own repository's service, read from the
   * workspace that links it; this is the fallback for a repository with none,
   * such as a monorepo. Null files a review only under its repository's service.
   */
  serviceId: string | null
  /** Pin the pipeline the review runs on. Omitted, the task's own pinned pipeline runs. */
  pipelineId?: string
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/**
 * The cat-factory run states that END a review, and what each means to us. Anything
 * absent from this table is in flight: a run is `blocked`/`paused` when it is
 * waiting on a human decision, and from sainte-beuve's side that is an unfinished
 * review rather than a failure. A state cat-factory adds later reads as in-flight
 * too, which is the safe default, because the next poll settles it.
 */
const TERMINAL_STATUSES: Record<string, 'completed' | 'failed' | 'cancelled'> = {
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
}

/**
 * The verdict text for a finished run: the last step that produced output. The full
 * transcript stays in cat-factory and the board shows a line, so this is capped
 * rather than stored whole.
 */
const SUMMARY_LIMIT = 2000

function summaryOf(steps: readonly { output: string | null }[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const output = steps[i]?.output?.trim()
    if (output) return output.slice(0, SUMMARY_LIMIT)
  }
  return null
}

/** A poll of a task cat-factory has accepted but not yet built a run for. */
const NO_RUN_YET: AiReviewReport = {
  status: 'running',
  runId: null,
  summary: null,
  failureReason: null,
  curation: null,
}

/**
 * Which of our states a run is in, given what its review is parked on.
 *
 * `awaiting_selection` is derived from the DECISION rather than from the run,
 * because the run only says that it stopped: it is `blocked` for a review waiting
 * on a curator and equally `blocked` for one whose fixer is mid-pass. Those two
 * need opposite things from a screen.
 */
function statusOf(run: PublicRun, curation: AiReviewCuration | null): AiReviewReport['status'] {
  const terminal = TERMINAL_STATUSES[run.status]
  if (terminal !== undefined) return terminal
  return curation?.status === 'awaiting_selection' ? 'awaiting_selection' : 'running'
}

export class CatFactoryAiReviewGateway implements AiReviewGateway {
  private readonly options: CatFactoryOptions
  /** Every call about a run names the workspace it was filed in. */
  private readonly clients: WorkspaceClients

  constructor(options: CatFactoryOptions) {
    this.options = options
    this.clients = new WorkspaceClients((workspaceId) => this.build(workspaceId))
  }

  private build(workspaceId: string | undefined): CatFactoryClient {
    const { options } = this
    return new CatFactoryClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userAgent: 'sainte-beuve',
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(options.personalPassword ? { personalPassword: options.personalPassword } : {}),
      // Deadlined at the transport, with the shared rule every adapter that
      // calls a host we do not control now carries (`withDeadline` in the
      // kernel). This was the first path to need it and the reason it exists:
      // the clock's sweep spends two calls per run in flight inside one cron
      // invocation, so one instance that accepts a connection and never answers
      // would hold the whole pass open. Given up on, the run records a refused
      // poll on its row — what the board already shows — and the sweep moves on.
      // The READ path gets it too: a board showing four reviews polls all four.
      fetch: withDeadline(options.fetch),
    })
  }

  async requestReview(
    input: CatFactoryPlacementTarget & { title: string; instructions: string | null },
  ): Promise<AiReviewHandle> {
    const ref = formatPullRequest(input.pullRequest)
    const brief = [`Review ${ref}: ${input.pullRequest.url}`, input.instructions]
      .filter((line): line is string => line !== null && line.length > 0)
      .join('\n\n')
    return this.fileAndStart(input, {
      kind: 'review',
      task: {
        title: `Review ${ref}: ${input.title}`.slice(0, 200),
        description: brief.slice(0, 2000),
        taskType: 'review',
      },
      pipelineId: this.options.pipelineId,
    })
  }

  async requestConflictResolution(input: CatFactoryPlacementTarget): Promise<AiReviewHandle> {
    const ref = formatPullRequest(input.pullRequest)
    return this.fileAndStart(input, {
      kind: 'conflict resolution',
      task: {
        title: `Resolve conflicts in ${ref}`.slice(0, 200),
        description:
          `Merge the base branch into ${ref} (${input.pullRequest.url}), resolve the ` +
          'conflicts, and push the result to its own branch.',
        taskType: 'resolve-conflicts',
        // cat-factory attaches the pull request by its number, which points the
        // resolver at its branch. The URL makes it refuse a service linked to
        // another repository, where the number would name somebody else's branch.
        fields: { prNumber: input.pullRequest.number, prUrl: input.pullRequest.url },
      },
      // No pipeline pinned: the one a deployment pins is a review pipeline, and
      // this task type brings its own.
      pipelineId: undefined,
    })
  }

  /**
   * File a task under the service backing the pull request's repository, in
   * the workspace that holds it, then start it. Create and start are two calls
   * in cat-factory's API on purpose (a task is editable before it runs), but
   * nothing filed from here has anything to edit.
   */
  private async fileAndStart(
    target: CatFactoryPlacementTarget,
    filing: { kind: string; task: CreatePublicTask; pipelineId: string | undefined },
  ): Promise<AiReviewHandle> {
    const { kind, task: body, pipelineId } = filing
    const placement = await placeTask(this.clients, {
      pullRequest: target.pullRequest,
      directoryKeys: target.directoryKeys,
      ownerDirectoryKeys: target.ownerDirectoryKeys ?? [],
      defaultServiceId: this.options.serviceId,
      appUrl: () => appUrlOf(this.options),
    })
    const client = this.clients.in(placement.workspaceId)
    let task: { taskId: string }
    try {
      task = await client.tasks.create(placement.serviceId, body)
    } catch (err) {
      throw refusalFor(err, `file a ${kind} task for ${formatPullRequest(target.pullRequest)}`)
    }
    try {
      await client.tasks.start(task.taskId, pipelineId === undefined ? {} : { pipelineId })
    } catch (err) {
      // Through the same translation as every other call, because this is where a
      // `write`-scope key is turned away: the run would park, so cat-factory will
      // not start one the caller could not answer. See `refusalFor`.
      throw refusalFor(err, `start the ${kind} task ${task.taskId} it had accepted`)
    }
    return {
      taskId: task.taskId,
      url: `${this.options.appUrl ?? this.options.baseUrl}/tasks/${task.taskId}`,
      workspaceId: placement.workspaceId,
    }
  }

  async getStatus(input: { taskId: string; workspaceId: string | null }): Promise<AiReviewReport> {
    const client = this.clients.in(input.workspaceId)
    const run = await this.readRun(client, input.taskId)
    if (run === null) return NO_RUN_YET
    // Only a run still in flight is asked what it is parked on. A settled one has
    // no decision left to read, because the entry leaves cat-factory's list with
    // the loop it belongs to, so the second call would answer nothing on every
    // poll of every finished review.
    const curation =
      TERMINAL_STATUSES[run.status] === undefined
        ? await this.readCuration(client, run.runId)
        : null
    const status = statusOf(run, curation)
    return {
      status,
      runId: run.runId,
      summary: status === 'completed' ? summaryOf(run.steps) : null,
      failureReason: run.error?.message ?? null,
      curation,
    }
  }

  /** The task's current run, or null when cat-factory has not built one yet. */
  private async readRun(client: CatFactoryClient, taskId: string): Promise<PublicRun | null> {
    try {
      return await client.tasks.getRun(taskId)
    } catch (err) {
      // A task that has been filed but whose run has not been created yet has no
      // run to read. That is the normal first poll, not a fault.
      if (err instanceof CatFactoryNotFoundError) return null
      throw refusalFor(err, `report the run status for task ${taskId}`)
    }
  }

  /**
   * The decision the run is parked on, or null when there is none to read.
   *
   * A 404 is null for the same reason it is on the run: it is an ORDINARY answer
   * here, not a fault. cat-factory prunes a run's decisions, a rotated key sees a
   * run outside its workspace, and an older instance may not serve the route at
   * all. Every one of those means "nothing to curate", and raising them would
   * fail the whole poll of a review whose findings are sitting right there.
   */
  private async readCuration(
    client: CatFactoryClient,
    runId: string,
  ): Promise<AiReviewCuration | null> {
    try {
      return curationOf(await client.decisions.list(runId))
    } catch (err) {
      if (err instanceof CatFactoryNotFoundError) return null
      throw refusalFor(err, `report the decisions for run ${runId}`)
    }
  }

  /**
   * Drop one finding, and answer with the review as the drop left it.
   *
   * The answer is KEPT here and discarded by the two verbs below, and the
   * difference is upstream's: dismissal is synchronous curation that leaves the
   * run parked, so the list cat-factory hands back is the whole effect and the
   * caller has nothing left to learn by re-reading it.
   */
  async dismissFinding(input: {
    runId: string
    findingId: string
    workspaceId: string | null
  }): Promise<AiReviewCuration | null> {
    const { decisions } = this.clients.in(input.workspaceId)
    return curationOf(
      await this.curating(`dismiss finding ${input.findingId}`, input.runId, () =>
        decisions.dismissPrReviewFinding(input.runId, input.findingId),
      ),
    )
  }

  async resolveReview(input: {
    runId: string
    action: AiReviewResolution
    findingIds: string[]
    workspaceId: string | null
  }): Promise<void> {
    const { decisions } = this.clients.in(input.workspaceId)
    await this.curating(`resolve the review as \`${input.action}\``, input.runId, () =>
      decisions.resolvePrReview(input.runId, {
        action: input.action,
        findingIds: input.findingIds,
      }),
    )
  }

  async resumeReview(input: { runId: string; workspaceId: string | null }): Promise<void> {
    const { decisions } = this.clients.in(input.workspaceId)
    await this.curating('resume the review', input.runId, () =>
      decisions.resumePrReview(input.runId),
    )
  }

  async challengeFinding(input: {
    runId: string
    findingId: string
    question: string | null
    workspaceId: string | null
  }): Promise<void> {
    const { decisions } = this.clients.in(input.workspaceId)
    const question = input.question?.trim()
    await this.curating(`challenge finding ${input.findingId}`, input.runId, () =>
      decisions.challengePrReviewFinding(
        input.runId,
        input.findingId,
        question ? { question } : {},
      ),
    )
  }

  /**
   * One curation verb, with its refusal translated.
   *
   * `resolveReview`, `resumeReview` and `challengeFinding` throw the answer
   * away, and that is the point for those three: cat-factory ACCEPTS the
   * instruction and acts on it afterwards, so the list it hands back records a
   * review as `posting` (or `challenging`) a moment before the receipt or the
   * verdict exists. Those three re-poll instead, through the one
   * path that maps a run (`getStatus`), so a row is never assembled two
   * different ways. `dismissFinding` is synchronous and keeps it.
   */
  private async curating<T>(what: string, runId: string, verb: () => Promise<T>): Promise<T> {
    try {
      return await verb()
    } catch (err) {
      throw refusalFor(err, `${what} on run ${runId}`)
    }
  }
}
