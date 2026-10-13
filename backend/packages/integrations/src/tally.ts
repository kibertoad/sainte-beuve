import type { AuthorTally, ReviewerTally } from '@sainte-beuve/kernel'

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
    for (const login of distinctLogins(logins)) {
      const key = login.toLowerCase()
      const tally = tallies.get(key) ?? { login, reviews: 0 }
      tallies.set(key, { login: tally.login, reviews: tally.reviews + 1 })
    }
  }
  return [...tallies.values()]
}

/** One entry per pull request opened, by its author's login, folded as {@link tallyVerdicts} folds. */
export function tallyAuthors(authorPerPullRequest: readonly string[]): AuthorTally[] {
  const tallies = new Map<string, AuthorTally>()
  for (const login of authorPerPullRequest) {
    const key = login.toLowerCase()
    const tally = tallies.get(key) ?? { login, pullRequests: 0 }
    tallies.set(key, { login: tally.login, pullRequests: tally.pullRequests + 1 })
  }
  return [...tallies.values()]
}

/** Each login once, compared case-insensitively, as first spelled, without `exclude`. */
export function distinctLogins(logins: readonly string[], exclude: string | null = null): string[] {
  const seen = new Set<string>(exclude === null ? [] : [exclude.toLowerCase()])
  const distinct: string[] = []
  for (const login of logins) {
    const key = login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(login)
  }
  return distinct
}
