import type { RepositoryLookup, RepositoryLookupQuery, VcsProvider } from '@sainte-beuve/contracts'
import { REPOSITORY_LOOKUP_MIN_QUERY } from '@sainte-beuve/contracts'

/** How long typing has to pause before the host is asked. */
const DEBOUNCE_MS = 300

/** The lookup's own alphabet. Anything else would come back as a 400, so it is not sent. */
const QUERY_ALPHABET = /^[A-Za-z0-9._-]+$/

export interface RepositoryLookupInput {
  provider: Readonly<Ref<VcsProvider>>
  owner: Readonly<Ref<string>>
  repo: Readonly<Ref<string>>
  /** False for a member: the route is an admin's, and asking it would only be refused. */
  enabled: Readonly<Ref<boolean>>
}

/**
 * The owner's repositories matching what has been typed so far, once there is
 * an owner and at least {@link REPOSITORY_LOOKUP_MIN_QUERY} characters.
 */
export function useRepositoryLookup(input: RepositoryLookupInput) {
  const api = useSainteBeuveApi()
  return useDebouncedQuery<RepositoryLookupQuery, RepositoryLookup | null>(
    () => {
      const owner = input.owner.value.trim()
      const query = input.repo.value.trim()
      const askable =
        input.enabled.value &&
        owner.length > 0 &&
        query.length >= REPOSITORY_LOOKUP_MIN_QUERY &&
        QUERY_ALPHABET.test(query)
      return askable ? { provider: input.provider.value, owner, query } : null
    },
    (query) => api.lookupRepositories(query),
    { debounceMs: DEBOUNCE_MS },
  )
}
