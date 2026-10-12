import type { ReviewerTally } from '@sainte-beuve/kernel'

/**
 * Each pull request counts once for everybody who gave it a verdict, however
 * many they gave. Logins are compared case-insensitively, as both hosts do, and
 * reported as first spelled.
 */
export function tallyVerdicts(
  reviewersPerPullRequest: readonly (readonly string[])[],
): ReviewerTally[] {
  const tallies = new Map<string, ReviewerTally>()
  for (const logins of reviewersPerPullRequest) {
    const seen = new Set<string>()
    for (const login of logins) {
      const key = login.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const tally = tallies.get(key) ?? { login, reviews: 0 }
      tallies.set(key, { login: tally.login, reviews: tally.reviews + 1 })
    }
  }
  return [...tallies.values()]
}
