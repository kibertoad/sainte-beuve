import type { HostSearch, OpenPullRequest, VcsProvider, Viewer } from '@sainte-beuve/contracts'
import { handleOf, VCS_PROVIDERS } from '@sainte-beuve/contracts'
import { getErrorMessage, type PullRequestSearchRole, type VcsGateway } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import type { VcsResolutions } from '../../integrations/resolve.js'

/**
 * The viewer's open pull requests in each role asked for, on each host they have
 * a handle on, wherever they are: the half of My PRs and My Reviews that the
 * registered projects cannot answer.
 *
 * The search runs with the credential that acts as a PERSON. An App
 * installation reaches only the repositories it is installed on, and searching
 * for somebody's pull requests is the one read where that is the wrong set.
 * Like the sweep, a host that cannot be searched does not fail the read.
 */

const NO_PERSON =
  'no personal credential for this host, so only the linked repositories are listed: sign in ' +
  'or paste a personal access token on the Configuration screen'

interface SearchHit {
  role: PullRequestSearchRole
  pullRequest: OpenPullRequest
  /** The credential that found it, which is the one known to reach it. */
  gateway: VcsGateway
}

export interface HostSearches {
  found: SearchHit[]
  /** One per host, failed when any of its searches did. */
  searches: HostSearch[]
}

export const NO_SEARCH: HostSearches = { found: [], searches: [] }

export async function searchHosts(
  container: AppContainer,
  resolutions: VcsResolutions,
  viewer: Viewer,
  roles: readonly PullRequestSearchRole[],
): Promise<HostSearches> {
  const results = await Promise.all(
    VCS_PROVIDERS.flatMap((provider) => {
      const handle = handleOf(viewer.reviewer.handles, provider)
      if (handle === null) return []
      return [searchHost(container, resolutions, { provider, handle, roles })]
    }),
  )
  return {
    found: results.flatMap((result) => result.found),
    searches: results.flatMap((result) => result.searches),
  }
}

async function searchHost(
  container: AppContainer,
  resolutions: VcsResolutions,
  target: { provider: VcsProvider; handle: string; roles: readonly PullRequestSearchRole[] },
): Promise<HostSearches> {
  const { provider, handle, roles } = target
  const resolved = await resolutions.asPerson(provider)
  if (resolved === null) {
    return { found: [], searches: [{ provider, ok: false, reason: NO_PERSON }] }
  }
  const { gateway } = resolved
  try {
    const found = await Promise.all(
      roles.map(async (role) =>
        (await gateway.searchOpenPullRequests({ username: handle, role })).map(
          (pullRequest): SearchHit => ({ role, pullRequest, gateway }),
        ),
      ),
    )
    return { found: found.flat(), searches: [{ provider, ok: true, reason: null }] }
  } catch (err) {
    container.logger.warn({ err, provider }, 'could not search a host for pull requests')
    return { found: [], searches: [{ provider, ok: false, reason: getErrorMessage(err) }] }
  }
}
