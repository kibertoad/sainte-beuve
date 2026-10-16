import type { PullRequestAssessment, PullRequestRef } from '@sainte-beuve/contracts'
import type { ExternalRiskAssessment } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveRiskAssessment } from '../../integrations/riskResolve.js'
import { catFactoryDirectoryKeys } from '../projects/directoryKeys.js'

const NOT_CONFIGURED =
  'cat-factory is not configured for this org, so its assessor cannot be asked: an admin sets its URL and key on the Configuration screen'

/** The score half of an external assessment, as it is kept per pull request. */
export function assessmentOf(
  pullRequest: PullRequestRef,
  external: ExternalRiskAssessment,
  assessedAt: number,
): PullRequestAssessment {
  return {
    pullRequest,
    headSha: external.headSha,
    scores: external.scores,
    changeClass: external.changeClass,
    rationale: external.rationale,
    assessedAt,
  }
}

/**
 * Pull requests scored by cat-factory's assessor, on request, for the lists to
 * show. A score only: nothing here approves, and no board row is opened. The
 * risk policy's own assessments land in the same store (see `RiskAssessmentService`).
 */
export class PullRequestAssessmentService {
  constructor(private readonly container: AppContainer) {}

  /** The stored assessment when there is one; otherwise cat-factory is asked, once. */
  async assess(pullRequest: PullRequestRef): Promise<PullRequestAssessment> {
    const { pullRequestAssessments } = this.container.repositories
    const stored = await pullRequestAssessments.get(pullRequest)
    if (stored !== null) return stored
    const gateway = requireCapability(await resolveRiskAssessment(this.container), NOT_CONFIGURED)
    const external = await gateway.assess({
      pullRequest,
      // No policy: the scores are what is kept, and cat-factory's verdict is not.
      policyId: null,
      directoryKeys: await catFactoryDirectoryKeys(this.container, pullRequest),
    })
    const assessment = assessmentOf(pullRequest, external, this.container.clock.now())
    await pullRequestAssessments.put(assessment)
    return assessment
  }

  lookUp(pullRequests: readonly PullRequestRef[]): Promise<PullRequestAssessment[]> {
    return this.container.repositories.pullRequestAssessments.listByPullRequests(pullRequests)
  }
}
