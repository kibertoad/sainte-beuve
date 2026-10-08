import type { HostSearch, OpenPullRequest, VcsProvider, Viewer } from '@sainte-beuve/contracts'
import { handleOf, VCS_PROVIDERS } from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import type { VcsResolutions } from '../../integrations/resolve.js'

/**
 * The viewer's open pull requests on each host they have a handle on, wherever
 * they are, for the repositories nobody has registered yet.
 *
 * The search runs with the credential that acts as a PERSON. An App
 * installation reaches only the repositories it is installed on, and searching
 * for somebody's pull requests is the one read where that is the wrong set.
 * Like the sweep, a host that cannot be searched does not fail the read.
 */

const NO_PERSON =
  'no personal credential for this host, so only the linked repositories are listed: sign in ' +
  'or paste a personal access token on the Configuration screen'

export interface AuthoredSearch {
  found: { pullRequest: OpenPullRequest; gateway: VcsGateway }[]
  searches: HostSearch[]
}

export const NO_SEARCH: AuthoredSearch = { found: [], searches: [] }

export async function searchAuthored(
  container: AppContainer,
  resolutions: VcsResolutions,
  viewer: Viewer,
): Promise<AuthoredSearch> {
  const results = await Promise.all(
    VCS_PROVIDERS.flatMap((provider) => {
      const handle = handleOf(viewer.reviewer.handles, provider)
      return handle === null ? [] : [searchHost(container, resolutions, provider, handle)]
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
  provider: VcsProvider,
  handle: string,
): Promise<AuthoredSearch> {
  const resolved = await resolutions.asPerson(provider)
  if (resolved === null) {
    return { found: [], searches: [{ provider, ok: false, reason: NO_PERSON }] }
  }
  const { gateway } = resolved
  try {
    const pullRequests = await gateway.listAuthoredOpenPullRequests(handle)
    return {
      found: pullRequests.map((pullRequest) => ({ pullRequest, gateway })),
      searches: [{ provider, ok: true, reason: null }],
    }
  } catch (err) {
    container.logger.warn({ err, provider }, 'could not search a host for authored pull requests')
    return { found: [], searches: [{ provider, ok: false, reason: getErrorMessage(err) }] }
  }
}
