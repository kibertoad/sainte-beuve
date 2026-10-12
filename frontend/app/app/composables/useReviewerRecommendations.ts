import type {
  OpenPullRequest,
  RecommendReviewersInput,
  ReviewerRecommendations,
} from '@sainte-beuve/contracts'

/** How long the dialog's choices have to settle before the ranking is asked again. */
const DEBOUNCE_MS = 250

/** How many recommendations the dialog shows. */
const SHOWN = 5

export interface RecommendationQuery {
  pullRequest: Readonly<Ref<OpenPullRequest | null>>
  requiredSkills: Readonly<Ref<string[]>>
  sameTeamOnly: Readonly<Ref<boolean>>
}

/**
 * The reviewers who fit a pull request best, re-read whenever the pull request
 * or the dialog's choices change. The previous ranking stays on screen while
 * the next one loads, so ticking a skill does not collapse the list.
 */
export function useReviewerRecommendations(input: RecommendationQuery) {
  const api = useSainteBeuveApi()
  return useDebouncedQuery<RecommendReviewersInput, ReviewerRecommendations>(
    () => {
      const open = input.pullRequest.value
      if (open === null) return null
      return {
        pullRequest: open.pullRequest,
        requiredSkills: [...input.requiredSkills.value],
        sameTeamOnly: input.sameTeamOnly.value,
        people: {
          authorLogin: open.authorLogin,
          requestedReviewerLogins: [...open.requestedReviewerLogins],
        },
        limit: SHOWN,
      }
    },
    (query) => api.recommendReviewers(query),
    { debounceMs: DEBOUNCE_MS, keepStale: true },
  )
}
