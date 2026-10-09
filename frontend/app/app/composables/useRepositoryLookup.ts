import type { RepositoryLookup, VcsProvider } from '@sainte-beuve/contracts'
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
 *
 * An answer is kept only if nothing was typed after it was asked for. Without
 * that, a slow reply for `pay` landing after a fast one for `payments` would
 * replace the suggestions with the wrong ones.
 */
export function useRepositoryLookup(input: RepositoryLookupInput) {
  const api = useSainteBeuveApi()
  const result = ref<RepositoryLookup | null>(null)
  const pending = ref(false)
  const failure = ref<string | null>(null)
  let latest = 0

  watch(
    [input.provider, input.owner, input.repo, input.enabled],
    ([provider, rawOwner, rawRepo, enabled], _previous, onCleanup) => {
      const ticket = ++latest
      const owner = rawOwner.trim()
      const query = rawRepo.trim()
      result.value = null
      failure.value = null
      pending.value =
        enabled &&
        owner.length > 0 &&
        query.length >= REPOSITORY_LOOKUP_MIN_QUERY &&
        QUERY_ALPHABET.test(query)
      if (!pending.value) return

      const timer = setTimeout(async () => {
        try {
          const answer = await api.lookupRepositories({ provider, owner, query })
          if (ticket === latest) result.value = answer
        } catch (err) {
          if (ticket === latest) failure.value = apiErrorMessage(err)
        } finally {
          if (ticket === latest) pending.value = false
        }
      }, DEBOUNCE_MS)
      onCleanup(() => clearTimeout(timer))
    },
  )

  return { result, pending, failure }
}
