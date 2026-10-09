import type { RepositoryLookup, RepositoryLookupQuery, VcsProvider } from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { VcsResolutions } from '../../integrations/resolve.js'

/**
 * The repositories an owner has on its host, for the Add form to suggest.
 *
 * A person's credential first, then whatever the deployment acts with. The
 * precedence `resolveVcs` documents puts an App first, and an App cannot search
 * an owner at all, so on a deployment holding both it would refuse a lookup the
 * sign-in beside it can answer.
 */
export class RepositoryLookupService {
  constructor(private readonly container: AppContainer) {}

  async lookup(query: RepositoryLookupQuery): Promise<RepositoryLookup> {
    const resolutions = new VcsResolutions(this.container)
    const resolved =
      (await resolutions.asPerson(query.provider)) ?? (await resolutions.acting(query.provider))
    const gateway = requireCapability(resolved, notConfigured(query.provider)).gateway
    return requireCapability(
      await gateway.lookupRepositories(query.owner, query.query),
      cannotSearch(query.provider),
    )
  }
}

function notConfigured(provider: VcsProvider): string {
  return (
    `No ${vcsDisplayName(provider)} credential is configured, so there is nothing to look ` +
    'repositories up with. An admin connects one on the Configuration screen.'
  )
}

function cannotSearch(provider: VcsProvider): string {
  return (
    `This deployment reaches ${vcsDisplayName(provider)} only as an App, which cannot list an ` +
    "owner's repositories. Sign in or store a token on the Configuration screen to look them up."
  )
}
