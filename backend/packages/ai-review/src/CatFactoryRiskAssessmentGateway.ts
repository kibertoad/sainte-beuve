import { CatFactoryClient } from '@cat-factory/sdk'
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
  UnavailableError,
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

/** cat-factory's assessment of one pull request, as its public API answers it. */
export interface PublicPrAssessment {
  headSha: string
  changeClass: string
  changedFileCount: number
  assessment: { complexity: number; risk: number; impact: number; rationale: string }
  policy: { policyId: string; name: string }
  verdict: {
    outcome: 'within_policy' | 'requires_review'
    reason: string
    exceededAxes: ('complexity' | 'risk' | 'impact')[]
  }
}

interface PrAssessmentsResource {
  assess(body: {
    owner: string
    repo: string
    prNumber: number
    provider: 'github' | 'gitlab'
    riskPolicyId?: string
  }): Promise<PublicPrAssessment>
}

/**
 * The SDK's `prAssessments` group, when the installed SDK has one.
 * TODO(kibertoad/cat-factory#2364): call it typed once `@cat-factory/sdk` 0.58.0 is the floor.
 */
function prAssessmentsOf(client: CatFactoryClient): PrAssessmentsResource | null {
  const resource = (client as unknown as { prAssessments?: Partial<PrAssessmentsResource> })
    .prAssessments
  return typeof resource?.assess === 'function' ? (resource as PrAssessmentsResource) : null
}

const REASONS: Record<string, RiskVerdictReason> = {
  within_thresholds: 'within_thresholds',
  exceeded_thresholds: 'exceeded_thresholds',
  class_auto_merge: 'class_auto_approve',
  class_requires_review: 'class_requires_review',
  auto_merge_disabled: 'policy_disabled',
  no_rationale: 'no_rationale',
}

function changeClassOf(value: string): ChangeClass {
  return (CHANGE_CLASSES as readonly string[]).includes(value) ? (value as ChangeClass) : 'unknown'
}

/**
 * A reason this build does not know cannot be read as a pass, so it holds the
 * pull request for a person whatever the outcome said.
 */
function verdictOf(answer: PublicPrAssessment): RiskVerdict {
  const reason = REASONS[answer.verdict.reason]
  const known = reason !== undefined
  return {
    outcome: known ? answer.verdict.outcome : 'requires_review',
    reason: reason ?? 'exceeded_thresholds',
    exceededAxes: answer.verdict.exceededAxes,
    policyName: answer.policy.name,
  }
}

export function toExternalAssessment(answer: PublicPrAssessment): ExternalRiskAssessment {
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
    const resource = prAssessmentsOf(this.clients.in(workspace?.workspaceId ?? null))
    if (resource === null) {
      throw new UnavailableError(
        'this build of the cat-factory SDK cannot assess a pull request; the heuristic assessor still can',
      )
    }
    const { provider, owner, repo, number } = input.pullRequest
    let answer: PublicPrAssessment
    try {
      answer = await resource.assess({
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
