import type {
  ApproverStatus,
  ExternalRiskPolicyList,
  RiskPolicy,
  RiskPolicySettings,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { resolveApprover, resolveRiskAssessment } from '../../integrations/riskResolve.js'
import { OrgService } from '../orgs/OrgService.js'
import { CAT_FACTORY_NOT_CONFIGURED } from './scoring.js'

/** The org's risk policy, and what a screen needs to say about it. */
export class RiskPolicyService {
  private readonly orgs: OrgService

  constructor(private readonly container: AppContainer) {
    this.orgs = new OrgService(container)
  }

  async read(): Promise<RiskPolicySettings> {
    const [org, github, gitlab, assessor] = await Promise.all([
      this.orgs.current(),
      this.approver('github'),
      this.approver('gitlab'),
      resolveRiskAssessment(this.container),
    ])
    return {
      policy: org.riskPolicy,
      approvers: { github, gitlab },
      catFactoryAvailable: assessor !== null,
    }
  }

  async write(policy: RiskPolicy): Promise<RiskPolicySettings> {
    await this.orgs.update({ riskPolicy: policy })
    return this.read()
  }

  /** The cat-factory policies for the picker, or why there are none. */
  async externalPolicies(): Promise<ExternalRiskPolicyList> {
    const gateway = await resolveRiskAssessment(this.container)
    if (gateway === null) return { policies: [], unavailableReason: CAT_FACTORY_NOT_CONFIGURED }
    try {
      return { policies: await gateway.listPolicies(), unavailableReason: null }
    } catch (err) {
      return { policies: [], unavailableReason: getErrorMessage(err) }
    }
  }

  private async approver(provider: VcsProvider): Promise<ApproverStatus> {
    const approver = await resolveApprover(this.container, provider)
    return { source: approver?.source ?? null, username: approver?.username ?? null }
  }
}
