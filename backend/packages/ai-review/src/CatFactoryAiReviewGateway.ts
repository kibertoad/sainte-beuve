import { CatFactoryClient, CatFactoryNotFoundError } from '@cat-factory/sdk'
import type { PullRequestRef } from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  type AiReviewHandle,
  UpstreamFailedError,
  formatPullRequest,
  getErrorMessage,
} from '@sainte-beuve/kernel'

/**
 * The cat-factory side of the AI-review port.
 *
 * sainte-beuve runs no models. It files a `review` task against a cat-factory
 * service and tracks the run, which is why this package depends on the PUBLISHED
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
  /** A cat-factory public-API key: `cf_live_<keyId>.<secret>`. */
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
}

/**
 * A cat-factory run is `blocked`/`paused` when it is waiting on a human decision.
 * From sainte-beuve's side that is still an unfinished review, not a failure: the
 * distinction the caller cares about is "has a verdict arrived", and a parked run
 * has not produced one.
 */
function mapRunStatus(status: string): 'running' | 'completed' | 'failed' | 'cancelled' {
  if (status === 'done') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
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
      throw new UpstreamFailedError(
        `cat-factory accepted the review task but refused to start it: ${getErrorMessage(err)}`,
        { taskId: task.taskId },
      )
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
      throw new UpstreamFailedError(
        `cat-factory refused the review task for ${ref}: ${getErrorMessage(err)}`,
      )
    }
  }

  async getStatus(taskId: string): Promise<{
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    summary: string | null
  }> {
    try {
      const run = await this.client.tasks.getRun(taskId)
      return { status: mapRunStatus(run.status), summary: run.error?.message ?? null }
    } catch (err) {
      // A task that has been filed but whose run has not been created yet has no
      // run to read. That is the normal first poll, not a fault.
      if (err instanceof CatFactoryNotFoundError) return { status: 'running', summary: null }
      throw new UpstreamFailedError(
        `cat-factory refused the run status for task ${taskId}: ${getErrorMessage(err)}`,
      )
    }
  }
}
