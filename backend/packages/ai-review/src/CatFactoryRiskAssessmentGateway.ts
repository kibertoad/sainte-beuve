import {
  CatFactoryClient,
  type PublicPrAssessment,
  type PublicPrAssessmentVerdictReason,
} from '@cat-factory/sdk'
import type {
  ChangeClass,
  ExternalRiskPolicy,
  PullRequestRef,
  RiskVerdict,
  RiskVerdictReason,
} from '@sainte-beuve/contracts'
import { CHANGE_CLASSES } from '@sainte-beuve/contracts'
import {
  type ExternalRiskAssessment,
  type RiskAssessmentGateway,
  formatPullRequest,
  withDeadline,
} from '@sainte-beuve/kernel'
import { appUrlOf, repositoryMissing } from './catFactoryApp.js'
import { refusalFor, refusalReason } from './refusals.js'
import { repositoryLocations } from './repositoryLocations.js'
import { WorkspaceClients } from './workspaceClients.js'

export interface CatFactoryRiskAssessmentOptions {
  baseUrl: string
  /** Origin of its web app, for the link that adds a repository. Null asks the instance. */
  appUrl?: string | null
  /**
   * `write` assesses, since an assessment spends model budget. Listing the
   * policies for the picker takes `admin` on cat-factory.
   */
  apiKey: string
  fetch?: typeof globalThis.fetch
}

/** cat-factory's assessment of one pull request, as much of it as is read here. */
export type PrAssessmentAnswer = Pick<
  PublicPrAssessment,
  'headSha' | 'changeClass' | 'changedFileCount' | 'assessment' | 'policy' | 'verdict'
>

const REASONS: Record<PublicPrAssessmentVerdictReason, RiskVerdictReason> = {
  within_thresholds: 'within_thresholds',
  exceeded_thresholds: 'exceeded_thresholds',
  class_auto_merge: 'class_auto_approve',
  class_requires_review: 'class_requires_review',
  auto_merge_disabled: 'policy_disabled',
  no_rationale: 'no_rationale',
  role_requires_review: 'role_requires_review',
  submission_not_allowed: 'submission_not_allowed',
  dry_run: 'dry_run',
}

function changeClassOf(value: string): ChangeClass {
  return (CHANGE_CLASSES as readonly string[]).includes(value) ? (value as ChangeClass) : 'unknown'
}

/**
 * A reason newer than this build cannot be read as a pass, so it holds the pull
 * request for a person whatever the outcome said.
 */
function verdictOf(answer: PrAssessmentAnswer): RiskVerdict {
  const reason = (REASONS as Partial<Record<string, RiskVerdictReason>>)[answer.verdict.reason]
  return {
    outcome: reason === undefined ? 'requires_review' : answer.verdict.outcome,
    reason: reason ?? 'unrecognised',
    exceededAxes: answer.verdict.exceededAxes,
    policyName: answer.policy.name,
  }
}

export function toExternalAssessment(answer: PrAssessmentAnswer): ExternalRiskAssessment {
  const { rationale, ...scores } = answer.assessment
  return {
    headSha: answer.headSha,
    changeClass: changeClassOf(answer.changeClass),
    changedFileCount: answer.changedFileCount,
    scores,
    rationale,
    verdict: verdictOf(answer),
  }
}

/** The cat-factory side of the risk-assessment port. */
export class CatFactoryRiskAssessmentGateway implements RiskAssessmentGateway {
  private readonly clients: WorkspaceClients
  private readonly options: CatFactoryRiskAssessmentOptions

  constructor(options: CatFactoryRiskAssessmentOptions) {
    this.options = options
    const { baseUrl, apiKey, fetch } = options
    this.clients = new WorkspaceClients(
      (workspaceId) =>
        new CatFactoryClient({
          baseUrl,
          apiKey,
          userAgent: 'sainte-beuve',
          fetch: withDeadline(fetch),
          ...(workspaceId === undefined ? {} : { workspaceId }),
        }),
    )
  }

  async assess(input: {
    pullRequest: PullRequestRef
    policyId: string | null
    directoryKeys: readonly string[]
  }): Promise<ExternalRiskAssessment> {
    const workspaceId = await this.workspaceOf(input.pullRequest, input.directoryKeys)
    const { provider, owner, repo, number } = input.pullRequest
    let answer: PublicPrAssessment
    try {
      answer = await this.clients.in(workspaceId).prAssessments.assess({
        owner,
        repo,
        prNumber: number,
        provider,
        ...(input.policyId === null ? {} : { riskPolicyId: input.policyId }),
      })
    } catch (err) {
      if (refusalReason(err) === 'repo_not_linked') throw await this.missing(input.pullRequest)
      throw refusalFor(err, 'assess the pull request', 'write')
    }
    return toExternalAssessment(answer)
  }

  /**
   * The first workspace linking the repository, which a key reaching several
   * has to name. Null asks the key's only workspace, when cat-factory's
   * directory could not be read to say which one links it.
   */
  private async workspaceOf(
    pullRequest: PullRequestRef,
    directoryKeys: readonly string[],
  ): Promise<string | null> {
    const locations = await repositoryLocations(this.clients, pullRequest, directoryKeys)
    if (locations === null) return null
    const first = locations[0]
    if (first === undefined) throw await this.missing(pullRequest)
    return first.workspaceId
  }

  private missing(pullRequest: PullRequestRef) {
    return repositoryMissing(
      pullRequest,
      () => appUrlOf(this.options),
      (repository) =>
        `Cannot assess ${formatPullRequest(pullRequest)}: no cat-factory workspace links its repository. ` +
        `Add ${repository} as a service in cat-factory, then assess it again`,
    )
  }

  async listPolicies(): Promise<ExternalRiskPolicy[]> {
    try {
      const { policies } = await this.clients.in(null).riskPolicies.list()
      return policies.map(({ policyId, name, isUnattendedDefault, autoMergeEnabled }) => ({
        policyId,
        name,
        isUnattendedDefault,
        autoMergeEnabled,
      }))
    } catch (err) {
      throw refusalFor(err, 'list its risk policies', 'admin')
    }
  }
}
