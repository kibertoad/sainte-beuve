import {
  type PersonReport,
  type Reviewer,
  VCS_PROVIDERS,
  type VcsProvider,
} from '@sainte-beuve/contracts'
import type { ReviewEvent } from '@sainte-beuve/kernel'
import { isAutomatedReviewer } from './automation.js'
import { metricsOf, type ReportedProject, type TimedPullRequest } from './metrics.js'
import { earliestReview, humanReviews, reviewsByOthers } from './milestones.js'

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
    const key = handleKey(provider, login)
    const known = tallies.get(key)
    if (known !== undefined) return known
    const fresh = { provider, login, reviewed: 0, approved: 0, firstToReview: 0, authored: [] }
    tallies.set(key, fresh)
    return fresh
  }
  for (const { project, timed } of repositories) {
    for (const entry of timed) countPullRequest(entry, (login) => tallyFor(project.provider, login))
  }
  const owners = ownersByHandle(directory)
  return [...tallies.entries()]
    .map(([key, tally]) => personReport(tally, owners.get(key)))
    .sort(
      (a, b) =>
        b.reviewed - a.reviewed || b.authored - a.authored || a.login.localeCompare(b.login),
    )
}

function handleKey(provider: VcsProvider, login: string): string {
  return `${provider}:${login.trim().toLowerCase()}`
}

function countPullRequest(entry: TimedPullRequest, tallyFor: (login: string) => Tally): void {
  const { authorLogin, authorBot } = entry.pullRequest
  if (authorLogin !== null && !isAutomatedReviewer(authorLogin, authorBot)) {
    tallyFor(authorLogin).authored.push(entry)
  }
  const reviews = humanReviews(reviewsByOthers(entry.pullRequest))
  const first = earliestReview(reviews)
  for (const { login, own } of byReviewer(reviews)) {
    const tally = tallyFor(login)
    tally.reviewed += 1
    if (own.some((review) => review.kind === 'approved')) tally.approved += 1
    if (first !== null && own.includes(first)) tally.firstToReview += 1
  }
}

/** The reviews grouped per reviewer, the handle compared case-insensitively. */
function byReviewer(reviews: readonly ReviewEvent[]): { login: string; own: ReviewEvent[] }[] {
  const grouped = new Map<string, { login: string; own: ReviewEvent[] }>()
  for (const review of reviews) {
    const key = review.login.toLowerCase()
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, { login: review.login, own: [review] })
    else group.own.push(review)
  }
  return [...grouped.values()]
}

/** The directory row holding each handle, keyed as the tallies are; the first claim wins. */
function ownersByHandle(directory: readonly DirectoryEntry[]): Map<string, DirectoryEntry> {
  const owners = new Map<string, DirectoryEntry>()
  for (const entry of directory) {
    for (const provider of VCS_PROVIDERS) {
      const handle = entry.handles[provider]
      if (handle === null) continue
      const key = handleKey(provider, handle)
      if (!owners.has(key)) owners.set(key, entry)
    }
  }
  return owners
}

function personReport(tally: Tally, person: DirectoryEntry | undefined): PersonReport {
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
    longestWaitingMs: longestWaiting(tally.authored),
  }
}

function longestWaiting(authored: readonly TimedPullRequest[]): number | null {
  let longest: number | null = null
  for (const { milestones } of authored) {
    const outcome = milestones.first_human_review
    if (outcome.state === 'waiting' && (longest === null || outcome.forMs > longest)) {
      longest = outcome.forMs
    }
  }
  return longest
}
