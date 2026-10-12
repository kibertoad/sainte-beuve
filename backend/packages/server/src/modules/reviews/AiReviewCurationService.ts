import type { AiReviewResolution, AiReviewRun } from '@sainte-beuve/contracts'
import { AI_REVIEW_CHALLENGE_LIMIT } from '@sainte-beuve/contracts'
import type { AiReviewGateway, AiReviewWorkspace } from '@sainte-beuve/kernel'
import { ConflictError, NotFoundError, ValidationError, assertFound } from '@sainte-beuve/kernel'
import {
  type AiChallengeAdmission,
  decideChallengeAdmission,
  retractedFindingIds,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { AiReviewService } from './AiReviewService.js'

/**
 * The curation verbs of a parked AI review: drop a finding, challenge one, act on
 * the selection, resume a stalled reviewer.
 *
 * Every verb is addressed by OUR run id and sent to cat-factory by its run id.
 * The asynchronous ones re-read the run afterwards through `AiReviewService`, the
 * one path that maps cat-factory's run onto a row, so a row is never assembled
 * two different ways. That service is held rather than rebuilt per call, because
 * it caches the request's cat-factory resolution.
 */
export class AiReviewCurationService {
  private readonly runs: AiReviewService

  constructor(private readonly container: AppContainer) {
    this.runs = new AiReviewService(container)
  }

  /**
   * Drop one finding from the parked review.
   *
   * No re-poll, unlike the verbs below it: the drop is synchronous and
   * cat-factory answers with the decision as the drop left it, so that answer IS
   * the fresh row.
   */
  async dismissFinding(runId: string, findingId: string): Promise<AiReviewRun> {
    const { gateway, target } = await this.curating(runId)
    const curation = await gateway.dismissFinding({ ...target, findingId })
    if (curation === null) return this.runs.get(runId)
    return assertFound(
      await this.container.repositories.aiReviewRuns.update(runId, { curation }),
      `No AI review run ${runId}`,
    )
  }

  /**
   * Ask cat-factory's investigator to re-examine one finding.
   *
   * Decided over the review as cat-factory reports it NOW, so the run is polled
   * first: a row that missed the last verdict would offer a second challenge of
   * a finding that already has its answer. The finding is recorded on the run
   * once cat-factory has accepted the challenge, because the budget counts it
   * even after a dismissal takes it out of the curation.
   *
   * Two challenges racing past the admission are not serialised here:
   * cat-factory takes a challenge only on a parked review and parks it no
   * longer once it has, so the second is refused upstream as a conflict.
   */
  async challenge(runId: string, findingId: string, question: string | null): Promise<AiReviewRun> {
    const { gateway, target } = await this.curating(runId)
    const run = await this.runs.get(runId)
    refuseUnlessAdmitted(decideChallengeAdmission(run, findingId), findingId)
    await gateway.challengeFinding({ ...target, findingId, question })
    await this.recordChallenged(run, findingId)
    return this.runs.get(runId)
  }

  /**
   * Record the curated selection and act on it.
   *
   * The empty-selection guard is here rather than left to cat-factory because it
   * is about what the CALLER asked for: `post` and `fix` both reach the real pull
   * request, and an empty selection on either is somebody who meant `finish`.
   * Upstream refuses it too, and a 502 naming a rule of ours is a worse answer
   * than a 400. A retracted finding is refused for the same reason: cat-factory
   * drops it from the selection without saying so, and a caller that asked to
   * post it would read the receipt as a comment that went missing. The run is
   * polled before that check for the reason `challenge` polls: the verdict that
   * retracted a finding may not have reached the row yet.
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
    const { gateway, target } = await this.curating(runId)
    refuseRetracted(await this.runs.get(runId), resolution)
    await gateway.resolveReview({ ...target, ...resolution })
    return this.runs.get(runId)
  }

  /** Re-dispatch the slices a stalled review never got back, then re-read the run. */
  async resume(runId: string): Promise<AiReviewRun> {
    const { gateway, target } = await this.curating(runId)
    await gateway.resumeReview(target)
    return this.runs.get(runId)
  }

  /**
   * The gateway, and the cat-factory run and workspace, a curation verb needs.
   *
   * A run with no cat-factory run id yet is a CONFLICT rather than a fault, and
   * it answers 409 rather than 404 so a caller can act on the difference: the
   * task was accepted and its run has not appeared, so the answer is to poll
   * again in a moment, where a 404 says the run is gone and to stop.
   */
  private async curating(runId: string): Promise<{
    gateway: AiReviewGateway
    target: { runId: string } & AiReviewWorkspace
  }> {
    const run = assertFound(
      await this.container.repositories.aiReviewRuns.getById(runId),
      `No AI review run ${runId}`,
    )
    const { gateway } = await this.runs.gateway()
    if (run.catFactoryRunId === null) {
      throw new ConflictError(
        `AI review run ${runId} has no cat-factory run yet, so there is nothing to curate. Poll it again in a moment`,
      )
    }
    return {
      gateway,
      target: { runId: run.catFactoryRunId, workspaceId: run.catFactoryWorkspaceId },
    }
  }

  private async recordChallenged(run: AiReviewRun, findingId: string): Promise<void> {
    if (run.challengedFindingIds.includes(findingId)) return
    await this.container.repositories.aiReviewRuns.update(run.id, {
      challengedFindingIds: [...run.challengedFindingIds, findingId],
    })
  }
}

function refuseRetracted(
  run: AiReviewRun,
  resolution: { action: AiReviewResolution; findingIds: string[] },
): void {
  if (resolution.action === 'finish') return
  const retracted = retractedFindingIds(run.curation)
  const named = resolution.findingIds.filter((findingId) => retracted.has(findingId))
  if (named.length === 0) return
  throw new ValidationError(
    `A challenge retracted ${named.join(', ')}, so it can no longer be acted on. Leave it out of the selection`,
  )
}

/** The sentence a refused challenge says. The rule is `decideChallengeAdmission`. */
function refuseUnlessAdmitted(decision: AiChallengeAdmission, findingId: string): void {
  if (decision.admitted) return
  switch (decision.reason) {
    case 'unknown_finding':
      throw new NotFoundError(`The review has no finding ${findingId} to challenge`)
    case 'not_parked':
      throw new ConflictError(
        'The review is not waiting on its findings, so there is nothing to challenge',
      )
    case 'challenging':
      throw new ConflictError(
        'A challenge is already being investigated on this review. Its verdict comes first',
      )
    case 'already_challenged':
      throw new ConflictError(
        `This finding was already challenged and ${decision.verdict === 'retracted' ? 'retracted' : `came back ${decision.verdict}`}`,
      )
    case 'review_limit':
      throw new ConflictError(
        `${AI_REVIEW_CHALLENGE_LIMIT} findings of this review have been challenged, which is as many as one review may have`,
      )
  }
}
