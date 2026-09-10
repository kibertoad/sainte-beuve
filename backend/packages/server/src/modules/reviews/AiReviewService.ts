import type { AiReviewResolution, AiReviewRun } from '@sainte-beuve/contracts'
import type { AiReviewGateway } from '@sainte-beuve/kernel'
import { ValidationError, assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { type Resolved, resolveAiReview } from '../../integrations/resolve.js'
import type { CredentialSource } from '../../integrations/resolve.js'

/**
 * Delegating a review to cat-factory, and driving the loop it parks in.
 *
 * The run row is written BEFORE the call goes out, in the `requested` state. That
 * ordering is the point: a call that never returns still leaves a trace of what was
 * asked for, so a stuck delegation is visible on the board instead of being a
 * request that silently evaporated.
 *
 * Everything after the request is a POLL. cat-factory drives the review
 * asynchronously and calls nothing back: a Worker deployment has no stable
 * inbound URL for it to reach during local development, and a webhook that only
 * works in production is a seam that breaks the day it matters. So every read
 * here refreshes what is still in flight, and every curation verb is followed by
 * a refresh, which is what keeps a row's status and its findings from being two
 * different moments. A cat-factory-side callback is a later OPTIMISATION over
 * this, never a replacement: see docs/implementation-plan.md, slice 4.
 */

/** The message a route answers with when cat-factory is not configured at all. */
const NOT_CONFIGURED =
  'cat-factory is not configured for this deployment: it needs a base URL, a service id and ' +
  'an API key with the `decide` scope (the key can be entered on the Configuration screen)'

/** The states a poll can still learn something from. Anything else is settled. */
const IN_FLIGHT = new Set<AiReviewRun['status']>(['requested', 'running', 'awaiting_selection'])

export class AiReviewService {
  constructor(private readonly container: AppContainer) {}

  async request(reviewId: string, instructions: string | null): Promise<AiReviewRun> {
    const { repositories, clock, ids } = this.container
    const resolved = await this.gateway()
    const review = assertFound(
      await repositories.reviews.getById(reviewId),
      `No review request ${reviewId}`,
    )
    const run = await repositories.aiReviewRuns.create({
      id: ids.next(),
      reviewId,
      status: 'requested',
      catFactoryTaskId: null,
      catFactoryRunId: null,
      catFactoryUrl: null,
      summary: null,
      failureReason: null,
      curation: null,
      requestedAt: clock.now(),
      completedAt: null,
    })

    try {
      const handle = await resolved.gateway.requestReview({
        pullRequest: review.pullRequest,
        title: review.title,
        instructions,
      })
      return assertFound(
        await repositories.aiReviewRuns.update(run.id, {
          status: 'running',
          catFactoryTaskId: handle.taskId,
          catFactoryUrl: handle.url,
        }),
        `No AI review run ${run.id}`,
      )
    } catch (err) {
      await repositories.aiReviewRuns.update(run.id, {
        status: 'failed',
        failureReason: getErrorMessage(err),
        completedAt: clock.now(),
      })
      throw err
    }
  }

  /**
   * Every run for one review, each polled if it is still in flight.
   *
   * Refreshing on the READ rather than only on a clock is what makes the loop
   * usable: opening the board is how a person learns the reviewer has parked with
   * findings, and a read served from the store would show them a review that had
   * been waiting on them for an hour as still running.
   */
  async listByReview(reviewId: string): Promise<AiReviewRun[]> {
    const runs = await this.container.repositories.aiReviewRuns.listByReview(reviewId)
    return Promise.all(runs.map(async (run) => (await this.refreshed(run)) ?? run))
  }

  /** One run, polled. */
  async get(runId: string): Promise<AiReviewRun> {
    const run = this.assertRun(await this.container.repositories.aiReviewRuns.getById(runId), runId)
    return (await this.refreshed(run)) ?? run
  }

  /**
   * Poll one in-flight run and write back what cat-factory reports.
   *
   * Answers null for a run there is nothing to learn about (settled, or never
   * acknowledged), so a caller can tell "polled, unchanged" from "not polled".
   */
  async refresh(runId: string): Promise<AiReviewRun | null> {
    const run = await this.container.repositories.aiReviewRuns.getById(runId)
    if (run === null) return null
    return (await this.refreshed(run)) ?? run
  }

  /** Drop one finding from the parked review, then re-read the run. */
  async dismissFinding(runId: string, findingId: string): Promise<AiReviewRun> {
    const { gateway, catFactoryRunId } = await this.curating(runId)
    await gateway.dismissFinding({ runId: catFactoryRunId, findingId })
    return this.get(runId)
  }

  /**
   * Record the curated selection and act on it.
   *
   * The empty-selection guard is here rather than left to cat-factory because it
   * is about what the CALLER asked for: `post` and `fix` both reach the real pull
   * request, and an empty selection on either is somebody who meant `finish`.
   * Upstream refuses it too, and a 502 naming a rule of ours is a worse answer
   * than a 400.
   */
  async resolve(
    runId: string,
    resolution: { action: AiReviewResolution; findingIds: string[] },
  ): Promise<AiReviewRun> {
    if (resolution.action !== 'finish' && resolution.findingIds.length === 0) {
      throw new ValidationError(
        `\`${resolution.action}\` needs at least one finding selected. Use \`finish\` to close a review without posting anything`,
      )
    }
    const { gateway, catFactoryRunId } = await this.curating(runId)
    await gateway.resolveReview({ runId: catFactoryRunId, ...resolution })
    return this.get(runId)
  }

  /** Re-dispatch the slices a stalled review never got back, then re-read the run. */
  async resume(runId: string): Promise<AiReviewRun> {
    const { gateway, catFactoryRunId } = await this.curating(runId)
    await gateway.resumeReview({ runId: catFactoryRunId })
    return this.get(runId)
  }

  /**
   * The gateway and the cat-factory run id a curation verb needs.
   *
   * A run with no cat-factory run id yet is a CONFLICT rather than a fault: the
   * task was accepted and its run has not appeared, so there is nothing to curate
   * and the answer is to poll again. It comes out as a 404 naming the local run,
   * which is what a caller reaching for a run that never started should see.
   */
  private async curating(
    runId: string,
  ): Promise<{ gateway: AiReviewGateway; catFactoryRunId: string }> {
    const run = this.assertRun(await this.container.repositories.aiReviewRuns.getById(runId), runId)
    const { gateway } = await this.gateway()
    return {
      gateway,
      catFactoryRunId: assertFound(
        run.catFactoryRunId,
        `AI review run ${runId} has no cat-factory run yet, so there is nothing to curate`,
      ),
    }
  }

  private async gateway(): Promise<Resolved<AiReviewGateway, CredentialSource>> {
    return requireCapability(await resolveAiReview(this.container), NOT_CONFIGURED)
  }

  private assertRun(run: AiReviewRun | null, runId: string): AiReviewRun {
    return assertFound(run, `No AI review run ${runId}`)
  }

  /**
   * The run as cat-factory reports it now, or null when there was nothing to ask.
   *
   * A cat-factory that cannot be reached leaves the row as it was rather than
   * failing the read: a board showing four reviews must not 502 because the
   * instance behind one of them is down, and the next poll settles it. The
   * refusal is logged, because "the findings never arrived" is otherwise a silent
   * symptom.
   */
  private async refreshed(run: AiReviewRun): Promise<AiReviewRun | null> {
    if (run.catFactoryTaskId === null || !IN_FLIGHT.has(run.status)) return null
    const resolved = await resolveAiReview(this.container)
    if (resolved === null) return null
    try {
      return await this.write(run, await resolved.gateway.getStatus(run.catFactoryTaskId))
    } catch (err) {
      this.container.logger.warn(
        { runId: run.id, taskId: run.catFactoryTaskId },
        `could not read the AI review from cat-factory: ${getErrorMessage(err)}`,
      )
      return null
    }
  }

  /**
   * What a poll writes back.
   *
   * `catFactoryRunId` is written once and never cleared, because it is the
   * address every curation verb is sent to: a poll that raced a run being rebuilt
   * would otherwise take the loop's only handle away mid-curation.
   */
  private async write(
    run: AiReviewRun,
    reported: Awaited<ReturnType<AiReviewGateway['getStatus']>>,
  ): Promise<AiReviewRun | null> {
    const settled = reported.status !== 'running' && reported.status !== 'awaiting_selection'
    return this.container.repositories.aiReviewRuns.update(run.id, {
      status: reported.status,
      catFactoryRunId: reported.runId ?? run.catFactoryRunId,
      summary: reported.summary,
      failureReason: reported.failureReason,
      curation: reported.curation,
      completedAt: settled ? this.container.clock.now() : null,
    })
  }
}
