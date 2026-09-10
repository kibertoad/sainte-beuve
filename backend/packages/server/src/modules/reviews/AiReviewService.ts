import type { AiReviewCuration, AiReviewResolution, AiReviewRun } from '@sainte-beuve/contracts'
import type { AiReviewGateway, AiReviewReport } from '@sainte-beuve/kernel'
import { ConflictError, ValidationError, assertFound, getErrorMessage } from '@sainte-beuve/kernel'
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
 * here refreshes what is still in flight, and each asynchronous curation verb is
 * followed by a refresh, which is what keeps a row's status and its findings from
 * being two different moments. A cat-factory-side callback is a later
 * OPTIMISATION over this, never a replacement: see docs/implementation-plan.md,
 * slice 4.
 */

/** The message a route answers with when cat-factory is not configured at all. */
const NOT_CONFIGURED =
  'cat-factory is not configured for this deployment: it needs a base URL, a service id and ' +
  'an API key with the `decide` scope (the key can be entered on the Configuration screen)'

/** The states a poll can still learn something from. Anything else is settled. */
const IN_FLIGHT = new Set<AiReviewRun['status']>(['requested', 'running', 'awaiting_selection'])

export class AiReviewService {
  /**
   * The cat-factory resolution for THIS request, made at most once.
   *
   * One service instance answers one route, which is the lifetime this may be
   * cached for and no longer: a key entered on the Configuration screen has to
   * take effect without a redeploy. Within the request it is worth caching,
   * because every resolution is a credential read plus an HKDF derivation plus an
   * AES-GCM open, and a review with four runs on it would otherwise pay for all
   * four. `VcsResolutions` does the same job for source control.
   */
  private resolution: Promise<Resolved<AiReviewGateway, CredentialSource> | null> | null = null

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
   * Answers null for a run there was nothing to ask about (no such run, settled,
   * or never acknowledged), so a caller sweeping rows can tell "polled" from "not
   * polled" instead of reading a row nobody asked about as fresh state. A poll
   * that was made and refused answers with the row, which carries the reason.
   */
  async refresh(runId: string): Promise<AiReviewRun | null> {
    const run = await this.container.repositories.aiReviewRuns.getById(runId)
    return run === null ? null : this.refreshed(run)
  }

  /**
   * Drop one finding from the parked review.
   *
   * No re-poll, unlike the two verbs below it: the drop is synchronous and
   * cat-factory answers with the decision as the drop left it, so that answer IS
   * the fresh row.
   */
  async dismissFinding(runId: string, findingId: string): Promise<AiReviewRun> {
    const { gateway, catFactoryRunId } = await this.curating(runId)
    const curation = await gateway.dismissFinding({ runId: catFactoryRunId, findingId })
    if (curation === null) return this.get(runId)
    return this.assertRun(
      await this.container.repositories.aiReviewRuns.update(runId, { curation }),
      runId,
    )
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
   * A run with no cat-factory run id yet is a CONFLICT rather than a fault, and
   * it answers 409 rather than 404 so a caller can act on the difference: the
   * task was accepted and its run has not appeared, so the answer is to poll
   * again in a moment, where a 404 says the run is gone and to stop.
   */
  private async curating(
    runId: string,
  ): Promise<{ gateway: AiReviewGateway; catFactoryRunId: string }> {
    const run = this.assertRun(await this.container.repositories.aiReviewRuns.getById(runId), runId)
    const { gateway } = await this.gateway()
    if (run.catFactoryRunId === null) {
      throw new ConflictError(
        `AI review run ${runId} has no cat-factory run yet, so there is nothing to curate. Poll it again in a moment`,
      )
    }
    return { gateway, catFactoryRunId: run.catFactoryRunId }
  }

  private async gateway(): Promise<Resolved<AiReviewGateway, CredentialSource>> {
    return requireCapability(await this.resolved(), NOT_CONFIGURED)
  }

  /** The resolution this request is working with. See {@link resolution}. */
  private async resolved(): Promise<Resolved<AiReviewGateway, CredentialSource> | null> {
    this.resolution ??= resolveAiReview(this.container)
    return this.resolution
  }

  private assertRun(run: AiReviewRun | null, runId: string): AiReviewRun {
    return assertFound(run, `No AI review run ${runId}`)
  }

  /**
   * The run as cat-factory reports it now, or null when there was nothing to ask.
   *
   * A cat-factory that cannot be reached leaves the row's STATUS as it was rather
   * than failing the read: a board showing four reviews must not 502 because the
   * instance behind one of them is down, and the next poll settles it.
   */
  private async refreshed(run: AiReviewRun): Promise<AiReviewRun | null> {
    if (run.catFactoryTaskId === null || !IN_FLIGHT.has(run.status)) return null
    const resolved = await this.resolved()
    if (resolved === null) return null
    try {
      return await this.write(run, await resolved.gateway.getStatus(run.catFactoryTaskId))
    } catch (err) {
      return this.pollRefused(run, err)
    }
  }

  /**
   * A poll that was refused, recorded ON the row.
   *
   * The status is left alone, because a cat-factory that is down for a minute
   * must not turn a running review into a failed one. What is not left alone is
   * the silence: a revoked key, or one that lost the `decide` scope, refuses every
   * poll the same way for ever, and a row that goes on saying `running` with
   * nothing beside it is indistinguishable on the board from a reviewer that is
   * merely slow. A log line reaches nobody who pressed the button. The next poll
   * that succeeds clears the reason along with everything else it writes.
   */
  private async pollRefused(run: AiReviewRun, err: unknown): Promise<AiReviewRun | null> {
    const reason = getErrorMessage(err)
    this.container.logger.warn(
      { runId: run.id, taskId: run.catFactoryTaskId },
      `could not read the AI review from cat-factory: ${reason}`,
    )
    return this.container.repositories.aiReviewRuns.update(run.id, {
      failureReason: `the AI review could not be read from cat-factory: ${reason}`,
    })
  }

  /**
   * What a poll writes back.
   *
   * Onto the row as it stands NOW rather than the one the poll started from. Two
   * reads of one review can have polls in flight at once and the slower answer is
   * the older one: a `running` report landing after a `completed` one would walk a
   * settled run back into flight, throw away the verdict text already recorded,
   * and re-stamp `completedAt` from a later clock reading on the poll after that.
   * So a settled row refuses an in-flight report, and `completedAt` is stamped
   * once.
   *
   * `catFactoryRunId` is written once and never cleared, because it is the
   * address every curation verb is sent to: a poll that raced a run being rebuilt
   * would otherwise take the loop's only handle away mid-curation.
   */
  private async write(run: AiReviewRun, reported: AiReviewReport): Promise<AiReviewRun | null> {
    const current = await this.container.repositories.aiReviewRuns.getById(run.id)
    if (current === null) return null
    const settled = reported.status !== 'running' && reported.status !== 'awaiting_selection'
    if (!settled && !IN_FLIGHT.has(current.status)) return current
    return this.container.repositories.aiReviewRuns.update(run.id, {
      status: reported.status,
      catFactoryRunId: reported.runId ?? current.catFactoryRunId,
      summary: reported.summary,
      failureReason: reported.failureReason,
      curation: curationFor(reported, current),
      completedAt: settled ? (current.completedAt ?? this.container.clock.now()) : null,
    })
  }
}

/**
 * The curation a poll writes, which KEEPS what the row already holds when the
 * report carries none.
 *
 * cat-factory drops the decision from a run's list the moment the loop it belongs
 * to settles, so the poll that sees a review finish is the poll that sees no
 * decision. Writing that through would destroy the post receipt, the findings and
 * the recorded selection at exactly the moment somebody wants to read what
 * landed, and nothing could recover them: the receipt would only ever be visible
 * in the accidental window between the post and the run settling.
 */
function curationFor(reported: AiReviewReport, current: AiReviewRun): AiReviewCuration | null {
  return reported.curation ?? current.curation
}
