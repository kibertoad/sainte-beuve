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
  withDeadline,
} from '@sainte-beuve/kernel'
import { locationOf } from './directoryKeys.js'
import { refusalFor } from './refusals.js'
import { WorkspaceClients } from './workspaceClients.js'

export interface CatFactoryRiskAssessmentOptions {
  baseUrl: string
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

  constructor(options: CatFactoryRiskAssessmentOptions) {
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
    const workspace = input.directoryKeys.map(locationOf).find((location) => location !== null)
    const { provider, owner, repo, number } = input.pullRequest
    let answer: PublicPrAssessment
    try {
      answer = await this.clients.in(workspace?.workspaceId ?? null).prAssessments.assess({
        owner,
        repo,
        prNumber: number,
        provider,
        ...(input.policyId === null ? {} : { riskPolicyId: input.policyId }),
      })
    } catch (err) {
      throw refusalFor(err, 'assess the pull request', 'write')
    }
    return toExternalAssessment(answer)
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
