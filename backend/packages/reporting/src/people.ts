import type { PersonReport, Reviewer, VcsProvider } from '@sainte-beuve/contracts'
import type { ReviewEvent } from '@sainte-beuve/kernel'
import { isAutomatedReviewer } from './automation.js'
import { metricsOf, type ReportedProject, type TimedPullRequest } from './metrics.js'
import { humanReviews, reviewsByOthers } from './milestones.js'

/** What a report needs of the directory to put a name to a handle. */
export type DirectoryEntry = Pick<Reviewer, 'id' | 'displayName' | 'handles'>

interface Tally {
  provider: VcsProvider
  login: string
  reviewed: number
  approved: number
  firstToReview: number
  authored: TimedPullRequest[]
}

/**
 * Everybody who reviewed or opened one of the report's pull requests, most
 * reviews first. A person is a handle on one host, compared case-insensitively
 * and spelled as first seen; the directory supplies a name where somebody
 * claims the handle. Reviews are counted per pull request, so three rounds of
 * comments on one change are one review.
 */
export function peopleOf(
  repositories: readonly { project: ReportedProject; timed: readonly TimedPullRequest[] }[],
  directory: readonly DirectoryEntry[],
): PersonReport[] {
  const tallies = new Map<string, Tally>()
  const tallyFor = (provider: VcsProvider, login: string): Tally => {
    const key = `${provider}:${login.toLowerCase()}`
    const known = tallies.get(key)
    if (known !== undefined) return known
    const fresh = { provider, login, reviewed: 0, approved: 0, firstToReview: 0, authored: [] }
    tallies.set(key, fresh)
    return fresh
  }
  for (const { project, timed } of repositories) {
    for (const entry of timed) countPullRequest(entry, (login) => tallyFor(project.provider, login))
  }
  return [...tallies.values()]
    .map((tally) => personReport(tally, directory))
    .sort(
      (a, b) =>
        b.reviewed - a.reviewed || b.authored - a.authored || a.login.localeCompare(b.login),
    )
}

function countPullRequest(entry: TimedPullRequest, tallyFor: (login: string) => Tally): void {
  const author = entry.pullRequest.authorLogin
  if (author !== null && !isAutomatedReviewer(author, false)) tallyFor(author).authored.push(entry)
  const reviews = humanReviews(reviewsByOthers(entry.pullRequest))
  const first = earliest(reviews)
  for (const [login, own] of byReviewer(reviews)) {
    const tally = tallyFor(login)
    tally.reviewed += 1
    if (own.some((review) => review.kind === 'approved')) tally.approved += 1
    if (first !== null && first.login.toLowerCase() === login.toLowerCase()) {
      tally.firstToReview += 1
    }
  }
}

function byReviewer(reviews: readonly ReviewEvent[]): Map<string, ReviewEvent[]> {
  const grouped = new Map<string, { login: string; reviews: ReviewEvent[] }>()
  for (const review of reviews) {
    const key = review.login.toLowerCase()
    const group = grouped.get(key) ?? { login: review.login, reviews: [] }
    group.reviews.push(review)
    grouped.set(key, group)
  }
  return new Map([...grouped.values()].map((group) => [group.login, group.reviews]))
}

function earliest(reviews: readonly ReviewEvent[]): ReviewEvent | null {
  return reviews.reduce<ReviewEvent | null>(
    (first, review) => (first === null || review.at < first.at ? review : first),
    null,
  )
}

function personReport(tally: Tally, directory: readonly DirectoryEntry[]): PersonReport {
  const person = directory.find(
    (entry) => entry.handles[tally.provider]?.toLowerCase() === tally.login.toLowerCase(),
  )
  return {
    provider: tally.provider,
    login: tally.login,
    reviewerId: person?.id ?? null,
    displayName: person?.displayName ?? null,
    reviewed: tally.reviewed,
    approved: tally.approved,
    firstToReview: tally.firstToReview,
    authored: tally.authored.length,
    authoredMetrics: metricsOf(tally.authored),
  }
}
