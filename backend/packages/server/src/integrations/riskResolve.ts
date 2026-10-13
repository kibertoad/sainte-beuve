import type { VcsProvider } from '@sainte-beuve/contracts'
import { vcsApproverCredentialKey } from '@sainte-beuve/contracts'
import type { RiskAssessmentGateway, VcsGateway } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'
import { type CatFactoryOrgAccess, catFactoryAccess, openCredential } from './resolve.js'

/** cat-factory's assessor for this org: its key and instance, and nothing else. */
export async function resolveRiskAssessment(
  container: AppContainer,
  pending: Promise<CatFactoryOrgAccess | null> = catFactoryAccess(container),
): Promise<RiskAssessmentGateway | null> {
  const access = await pending
  if (access === null) return null
  return (
    container.gateways?.riskAssessment({ baseUrl: access.config.baseUrl, apiKey: access.apiKey }) ??
    null
  )
}

/** The account automatic approvals go out as on one host. */
export interface Approver {
  gateway: VcsGateway
  source: 'token' | 'app'
  /** Null when the host does not say (a GitHub App installation identifies nobody). */
  username: string | null
}

/**
 * The org's approver token for the host, then the deployment's GitHub App. Never
 * a person's sign-in or pasted token: an approval posted as somebody who did not
 * review is the one thing this must not do.
 */
export async function resolveApprover(
  container: AppContainer,
  provider: VcsProvider,
): Promise<Approver | null> {
  const key = vcsApproverCredentialKey(provider)
  const token = await openCredential(container, key)
  const fromToken =
    token === null ? null : (container.gateways?.vcsFromToken(provider, token) ?? null)
  if (fromToken !== null) {
    const row = await container.repositories.integrationTokens.get(key)
    return { gateway: fromToken, source: 'token', username: row?.subject ?? null }
  }
  const asApp = container.gateways?.vcsAsApp(provider) ?? null
  if (asApp === null) return null
  const slug = container.github.appSlug
  return { gateway: asApp, source: 'app', username: slug === null ? null : `${slug}[bot]` }
}
