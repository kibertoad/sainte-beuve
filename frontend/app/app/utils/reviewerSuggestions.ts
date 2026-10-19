import type { ReviewerSuggestions, SuggestedReviewerState } from '@sainte-beuve/contracts'

/** What the dialog says about somebody already on the pull request. */
export function involvementLabel(state: SuggestedReviewerState): string {
  switch (state) {
    case 'committed':
      return 'Committed'
    case 'asked':
      return 'Asked, no answer yet'
    case 'requested':
      return 'Requested on the host'
    case 'declined':
      return 'Declined'
  }
}

/** Everybody to ask: the ticked matches first, then the people added by search, each once. */
export function reviewersToAsk(ticked: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...ticked, ...added])]
}

/** The people the search offers: everybody in the directory who is not already listed above it. */
export function searchableReviewers(
  suggestions: ReviewerSuggestions,
): { label: string; value: string }[] {
  return suggestions.others.map((person) => ({
    label: person.team === null ? person.displayName : `${person.displayName} · ${person.team}`,
    value: person.reviewerId,
  }))
}

export function askLabel(count: number): string {
  if (count === 0) return 'Pick somebody to ask'
  return count === 1 ? 'Ask 1 reviewer' : `Ask ${count} reviewers`
}

export function askedLabel(count: number): string {
  return count === 1 ? 'Asked 1 reviewer' : `Asked ${count} reviewers`
}
