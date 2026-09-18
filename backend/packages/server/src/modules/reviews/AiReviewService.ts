import type { AiReviewResolution, AiReviewRun } from '@sainte-beuve/contracts'
import { AI_REVIEW_IN_FLIGHT_STATUSES } from '@sainte-beuve/contracts'
import type { AiReviewGateway, AiReviewReport } from '@sainte-beuve/kernel'
import { ConflictError, ValidationError, assertFound, getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { type Resolved, resolveAiReview } from '../../integrations/resolve.js'
import type { CredentialSource } from '../../integrations/resolve.js'
import { abandonIfOrphaned } from './orphans.js'
import { NOT_POLLED, type PollOutcome, parkedAtFor, parksIn, replanForPark } from './park.js'
import { curationFor } from './reconcile.js'

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
 *
 * Polls come from two places and neither replaces the other. A READ polls the
 * runs it is about, so an open row is live. The reminder CLOCK polls what a
 * tenancy has in flight (`sweepInFlight`), so a review that parked while
 * everybody's board was closed is a fact the deployment holds rather than one
 * waiting to be discovered. Without the first, an open row would go stale under
 * somebody's eyes; without the second, a review would wait on a person who has
 * no way of knowing it is waiting on them.
 */

/** The message a route answers with when cat-factory is not configured at all. */
const NOT_CONFIGURED =
  'cat-factory is not configured for this deployment: it needs a base URL, a service id and ' +
  'an API key with the `decide` scope (the key can be entered on the Configuration screen)'

/** The states a poll can still learn something from. Anything else is settled. */
const IN_FLIGHT = new Set<AiReviewRun['status']>(AI_REVIEW_IN_FLIGHT_STATUSES)

export class AiReviewService {
  /**
   * The cat-factory resolution for THIS request, made at most once.
   *
   * One service instance answers one route, or one org's pass of the clock,
   * which is the lifetime this may be cached for and no longer: a key entered on
   * the Configuration screen has to take effect without a redeploy. Within that
   * pass it is worth caching, because every resolution is a credential read plus
   * an HKDF derivation plus an AES-GCM open, and a review with four runs on it —
   * or a tenancy with forty in flight — would otherwise pay for every one.
   * `VcsResolutions` does the same job for source control.
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
      lastPolledAt: null,
      parkedAt: null,
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
    const polled = await Promise.all(
      runs.map(async (run) => {
        const outcome = await this.poll(run)
        return { ...outcome, run: outcome.run ?? run }
      }),
    )
    // ONE re-plan for the review, after every poll has landed, rather than one per
    // run: two runs on a review can park in the same read, and the ladder is a
    // single row rewritten by a cancel-then-create. See `replanForPark`.
    await replanForPark(this.container, parksIn(polled))
    return polled.map((outcome) => outcome.run)
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
   * Poll every run this org has in flight, and say how many were asked about.
   *
   * What the reminder clock calls, and the half of the loop a read cannot
   * supply: cat-factory calls nothing back, so until something asks on a
   * schedule, a review that parks with its findings is waiting on a person who
   * has no way of knowing it is. Opening the row still polls, because that is
   * what makes an open row live; this is what makes a CLOSED one true.
   *
   * SEQUENTIAL rather than `Promise.all`, unlike the read path. A read polls the
   * runs of one review, which is a handful; this polls a whole tenancy's, and a
   * tick that opened thirty connections to one cat-factory at once would be
   * rate-limited into exactly the silence it exists to end.
   *
   * The STORE is asked first and the credential only after it has something to
   * answer for. A tenancy with nothing in flight is the common case on the
   * clock — most orgs are not mid-review most minutes — and the in-flight read is
   * one indexed, capped lookup where resolving is a credential read plus an HKDF
   * derivation plus an AES-GCM open. Ordered the other way round, every org paid
   * for a gateway on every tick to learn there was nothing to use it on.
   */
  async sweepInFlight(limit: number): Promise<number> {
    const runs = await this.container.repositories.aiReviewRuns.listInFlight(limit)
    let polled = 0
    for (const run of runs) {
      if (await this.sweepOne(run)) polled += 1
    }
    return polled
  }

  /**
   * One run out of the sweep's batch. Answers whether cat-factory was asked
   * about it.
   *
   * Nothing here ends the sweep. A poll that was refused is recorded on the row
   * by `pollRefused` and the next run in the batch is a different review, often
   * with a different outcome; a run with nothing to poll is written off rather
   * than skipped, for the reason `abandonIfOrphaned` gives.
   */
  private async sweepOne(run: AiReviewRun): Promise<boolean> {
    if (run.catFactoryTaskId === null) {
      await abandonIfOrphaned(this.container, run)
      return false
    }
    return (await this.refreshed(run)) !== null
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
   * The run as cat-factory reports it now, or null when there was nothing to ask,
   * with the reminder ladder put back in step if the poll moved the park.
   *
   * What every caller but `listByReview` polls through. That one re-plans for
   * itself, because it polls several runs of ONE review and the ladder is a single
   * row: see `replanForPark`.
   */
  private async refreshed(run: AiReviewRun): Promise<AiReviewRun | null> {
    const outcome = await this.poll(run)
    if (outcome.park !== null) await replanForPark(this.container, [outcome.park])
    return outcome.run
  }

  /**
   * The poll itself, without the re-plan that may follow it.
   *
   * A cat-factory that cannot be reached leaves the row's STATUS as it was rather
   * than failing the read: a board showing four reviews must not 502 because the
   * instance behind one of them is down, and the next poll settles it. Which is
   * also why the catch ENDS here and the re-plan sits outside it: a reminder-store
   * failure recorded on the run as "the AI review could not be read from
   * cat-factory" would name the wrong system, and leave the park stamped and
   * never announced.
   */
  private async poll(run: AiReviewRun): Promise<PollOutcome> {
    if (run.catFactoryTaskId === null || !IN_FLIGHT.has(run.status)) return NOT_POLLED
    const resolved = await this.resolved()
    if (resolved === null) return NOT_POLLED
    try {
      return await this.write(run, await resolved.gateway.getStatus(run.catFactoryTaskId))
    } catch (err) {
      return { run: await this.pollRefused(run, err), park: null }
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
    // Onto the row as it stands NOW, for the reason `write` re-reads. The sweep
    // walks a batch it snapshotted and spends two calls per run, so a refusal
    // can come back after a read or a curation verb has settled the run — and a
    // settled run is never polled again, so nothing would ever clear the reason.
    // The board would say for ever that a finished review could not be read.
    const { aiReviewRuns } = this.container.repositories
    const current = await aiReviewRuns.getById(run.id)
    if (current === null || !IN_FLIGHT.has(current.status)) return current
    return aiReviewRuns.update(run.id, {
      failureReason: `the AI review could not be read from cat-factory: ${reason}`,
      lastPolledAt: this.container.clock.now(),
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
  private async write(run: AiReviewRun, reported: AiReviewReport): Promise<PollOutcome> {
    const now = this.container.clock.now()
    const current = await this.container.repositories.aiReviewRuns.getById(run.id)
    if (current === null) return NOT_POLLED
    const settled = reported.status !== 'running' && reported.status !== 'awaiting_selection'
    if (!settled && !IN_FLIGHT.has(current.status)) return { run: current, park: null }
    const curation = curationFor(reported, current)
    const written = await this.container.repositories.aiReviewRuns.update(run.id, {
      status: reported.status,
      catFactoryRunId: reported.runId ?? current.catFactoryRunId,
      summary: reported.summary,
      failureReason: reported.failureReason,
      curation,
      // Stamped by the POLL and not by the report, so a run the clock has just
      // asked about goes to the back of the rotation whatever came back. See
      // `AiReviewRunRepository.listInFlight`.
      lastPolledAt: now,
      parkedAt: parkedAtFor(current, { status: reported.status, curation }, now),
      completedAt: settled ? (current.completedAt ?? now) : null,
    })
    const moved = written !== null && written.parkedAt !== current.parkedAt
    return {
      run: written,
      park: moved ? { reviewId: run.reviewId, runId: run.id, previous: current.parkedAt } : null,
    }
  }
}
