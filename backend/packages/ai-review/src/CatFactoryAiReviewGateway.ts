import { CatFactoryClient, CatFactoryNotFoundError, type PublicRun } from '@cat-factory/sdk'
import type { AiReviewCuration, AiReviewResolution, PullRequestRef } from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  type AiReviewHandle,
  type AiReviewReport,
  formatPullRequest,
} from '@sainte-beuve/kernel'
import { curationOf } from './curation.js'
import { refusalFor } from './refusals.js'

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
   * A cat-factory public-API key: `cf_live_<keyId>.<secret>`. It needs the
   * `decide` scope rather than just `write`: a `review` task PARKS on its
   * findings, and cat-factory refuses to start a run that the calling key could
   * not then answer. The refusal names the scope, and it arrives when the review
   * is filed, which is where this deployment reports it.
   */
  apiKey: string
  /**
   * The cat-factory service (repository frame) review tasks are filed under. One
   * service per repository is cat-factory's own model, so a deployment reviewing
   * several repos configures a mapping; the single-service default is the
   * starting point, not the end state (docs/implementation-plan.md, slice 4).
   */
  serviceId: string
  /** Pin the pipeline the review runs on. Omitted, the task's own pinned pipeline runs. */
  pipelineId?: string
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
}

/**
 * How long any one call to cat-factory may take before it is given up on.
 *
 * A deadline rather than none, because the clock's sweep spends two of these per
 * run in flight, sequentially, inside one cron invocation. A single instance that
 * accepts a connection and then never answers would otherwise hold that whole
 * pass open: on the Worker it burns the invocation, and on Node it is the pass
 * every later interval is skipped in favour of. Given up on, the run records a
 * refused poll on its row — which is what the board already shows — and the sweep
 * moves to the next one.
 *
 * Generous enough that nothing merely busy is cut off: cat-factory's own reads
 * answer in milliseconds, and the review itself is asynchronous, so no call this
 * gateway makes is waiting on a model.
 */
const CALL_TIMEOUT_MS = 20_000

/**
 * The same fetch, with a deadline on every request.
 *
 * Wrapped at the transport rather than at each call site, so the READ path gets
 * it too: a board showing four reviews polls all four, and one instance hanging
 * must not hold a person's request open until their browser gives up.
 *
 * A signal the SDK supplies is kept and combined rather than replaced — the
 * caller's own cancellation is not ours to drop.
 */
function withDeadline(impl: typeof globalThis.fetch, timeoutMs: number): typeof globalThis.fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs)
    const caller = init?.signal
    return impl(input, {
      ...init,
      signal: caller == null ? deadline : AbortSignal.any([caller, deadline]),
    })
  }
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
  private readonly client: CatFactoryClient
  private readonly options: CatFactoryOptions

  constructor(options: CatFactoryOptions) {
    this.options = options
    this.client = new CatFactoryClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userAgent: 'sainte-beuve',
      fetch: withDeadline(options.fetch ?? globalThis.fetch, CALL_TIMEOUT_MS),
    })
  }

  async requestReview(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
  }): Promise<AiReviewHandle> {
    const task = await this.createTask(input)
    // Create and start are two calls in cat-factory's API on purpose (a task is
    // editable before it runs), but a review has nothing to edit, so file it and go.
    try {
      await this.client.tasks.start(
        task.taskId,
        this.options.pipelineId === undefined ? {} : { pipelineId: this.options.pipelineId },
      )
    } catch (err) {
      // Through the same translation as every other call, because this is where a
      // `write`-scope key is turned away: the run would park, so cat-factory will
      // not start one the caller could not answer. See `refusalFor`.
      throw refusalFor(err, `start the review task ${task.taskId} it had accepted`)
    }
    return { taskId: task.taskId, url: `${this.options.baseUrl}/tasks/${task.taskId}` }
  }

  private async createTask(input: {
    pullRequest: PullRequestRef
    title: string
    instructions: string | null
  }) {
    const ref = formatPullRequest(input.pullRequest)
    const brief = [`Review ${ref}: ${input.pullRequest.url}`, input.instructions]
      .filter((line): line is string => line !== null && line.length > 0)
      .join('\n\n')
    try {
      return await this.client.tasks.create(this.options.serviceId, {
        title: `Review ${ref}: ${input.title}`.slice(0, 200),
        description: brief.slice(0, 2000),
        taskType: 'review',
      })
    } catch (err) {
      throw refusalFor(err, `file a review task for ${ref}`)
    }
  }

  async getStatus(taskId: string): Promise<AiReviewReport> {
    const run = await this.readRun(taskId)
    if (run === null) return NO_RUN_YET
    // Only a run still in flight is asked what it is parked on. A settled one has
    // no decision left to read, because the entry leaves cat-factory's list with
    // the loop it belongs to, so the second call would answer nothing on every
    // poll of every finished review.
    const curation =
      TERMINAL_STATUSES[run.status] === undefined ? await this.readCuration(run.runId) : null
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
  private async readRun(taskId: string): Promise<PublicRun | null> {
    try {
      return await this.client.tasks.getRun(taskId)
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
  private async readCuration(runId: string): Promise<AiReviewCuration | null> {
    try {
      return curationOf(await this.client.decisions.list(runId))
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
  }): Promise<AiReviewCuration | null> {
    return curationOf(
      await this.curating(`dismiss finding ${input.findingId}`, input.runId, () =>
        this.client.decisions.dismissPrReviewFinding(input.runId, input.findingId),
      ),
    )
  }

  async resolveReview(input: {
    runId: string
    action: AiReviewResolution
    findingIds: string[]
  }): Promise<void> {
    await this.curating(`resolve the review as \`${input.action}\``, input.runId, () =>
      this.client.decisions.resolvePrReview(input.runId, {
        action: input.action,
        findingIds: input.findingIds,
      }),
    )
  }

  async resumeReview(input: { runId: string }): Promise<void> {
    await this.curating('resume the review', input.runId, () =>
      this.client.decisions.resumePrReview(input.runId),
    )
  }

  /**
   * One curation verb, with its refusal translated.
   *
   * `resolveReview` and `resumeReview` throw the answer away, and that is the
   * point for those two: cat-factory ACCEPTS the instruction and acts on it
   * afterwards, so the list it hands back records a review as `posting` a moment
   * before the post report exists. Those two re-poll instead, through the one
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
