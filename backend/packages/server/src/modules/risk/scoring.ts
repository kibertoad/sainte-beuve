import type {
  ChangeClass,
  PullRequestRef,
  RiskPolicy,
  RiskScores,
  RiskVerdict,
} from '@sainte-beuve/contracts'
import { UnavailableError, type VcsGateway } from '@sainte-beuve/kernel'
import { assessChangedFiles, evaluateRiskPolicy } from '@sainte-beuve/risk'
import type { AppContainer } from '../../container.js'
import { resolveRiskAssessment } from '../../integrations/riskResolve.js'
import { catFactoryDirectoryKeys } from '../projects/directoryKeys.js'

/** What one assessment read and concluded. */
export interface Scored {
  headSha: string
  changeClass: ChangeClass
  changedFileCount: number
  scores: RiskScores
  rationale: string
  verdict: RiskVerdict
}

export const CAT_FACTORY_NOT_CONFIGURED =
  'the risk policy assesses with cat-factory, and cat-factory is not configured for this org'

/** Score with cat-factory, judged by its policy or by the org's own ceilings. */
async function scoreWithCatFactory(
  container: AppContainer,
  pullRequest: PullRequestRef,
  policy: RiskPolicy,
): Promise<Scored> {
  const gateway = await resolveRiskAssessment(container)
  if (gateway === null) throw new UnavailableError(CAT_FACTORY_NOT_CONFIGURED)
  const external = await gateway.assess({
    pullRequest,
    policyId: policy.policySource === 'cat-factory' ? policy.catFactoryPolicyId : null,
    directoryKeys: await catFactoryDirectoryKeys(container, pullRequest),
  })
  const verdict =
    policy.policySource === 'cat-factory' ? external.verdict : evaluateRiskPolicy(external, policy)
  return { ...external, verdict }
}

/** Score from the changed files alone, judged by the org's own ceilings. */
async function scoreHeuristically(
  vcs: VcsGateway,
  pullRequest: PullRequestRef,
  headSha: string,
  policy: RiskPolicy,
): Promise<Scored> {
  const { files, truncated } = await vcs.changedFiles(pullRequest)
  const reading = assessChangedFiles(files, truncated)
  return { ...reading, headSha, verdict: evaluateRiskPolicy(reading, policy) }
}

/** Assess one pull request at `headSha` under the org's policy. */
export async function scorePullRequest(
  container: AppContainer,
  input: { vcs: VcsGateway; pullRequest: PullRequestRef; headSha: string; policy: RiskPolicy },
): Promise<Scored> {
  const { vcs, pullRequest, headSha, policy } = input
  return policy.assessor === 'cat-factory'
    ? scoreWithCatFactory(container, pullRequest, policy)
    : scoreHeuristically(vcs, pullRequest, headSha, policy)
}
