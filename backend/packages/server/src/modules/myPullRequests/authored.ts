import type { PullRequestStatus, Viewer, VcsProvider } from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import {
  ConflictError,
  ForbiddenError,
  type PullRequestAddress,
  UnavailableError,
  type VcsGateway,
} from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { NO_CREDENTIAL } from '../workspace/sweep.js'

/** An open pull request the viewer authored, as its host reports it now. */
export interface AuthoredPullRequest {
  viewer: Viewer
  gateway: VcsGateway
  status: PullRequestStatus
}

/**
 * Re-read a pull request on its host and refuse it unless the viewer opened it
 * and it is still open. Every My PRs write goes through this, because each one
 * acts with the deployment's credential rather than the viewer's own.
 */
export async function readAuthored(
  container: AppContainer,
  principal: RequestPrincipal,
  address: PullRequestAddress,
  notYours: string,
): Promise<AuthoredPullRequest> {
  const viewer = await new ViewerService(container, principal).current()
  const gateway = await actingGateway(container, address.provider)
  const status = await gateway.pullRequestStatus(address)
  if (!isSameHandle(handleOf(viewer.reviewer.handles, address.provider), status.authorLogin)) {
    throw new ForbiddenError(notYours)
  }
  if (status.state !== 'open') throw new ConflictError(`This pull request is ${status.state}.`)
  return { viewer, gateway, status }
}

async function actingGateway(container: AppContainer, provider: VcsProvider): Promise<VcsGateway> {
  const resolved = await new VcsResolutions(container).acting(provider)
  if (resolved === null) throw new UnavailableError(`Cannot reach ${provider}: ${NO_CREDENTIAL}`)
  return resolved.gateway
}
