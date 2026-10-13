import type { ToReviewReasons } from '@sainte-beuve/contracts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** The most reviewer handles a chip names before it counts the rest. */
const NAMED_REVIEWERS = 3

export interface ReasonChip {
  label: string
  color: 'primary' | 'warning' | 'neutral'
}

function counted(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/** A span of milliseconds in the largest unit that keeps it a whole number above zero. */
export function formatElapsed(ms: number): string {
  if (ms < HOUR) return counted(Math.max(1, Math.floor(ms / MINUTE)), 'minute')
  if (ms < DAY) return counted(Math.floor(ms / HOUR), 'hour')
  if (ms < 2 * WEEK) return counted(Math.floor(ms / DAY), 'day')
  return counted(Math.floor(ms / WEEK), 'week')
}

function namedList(names: readonly string[]): string {
  const shown = names.slice(0, NAMED_REVIEWERS).join(', ')
  const rest = names.length - NAMED_REVIEWERS
  return rest > 0 ? `${shown} and ${rest} more` : shown
}

function commitmentChips(reasons: ToReviewReasons): ReasonChip[] {
  const chips: ReasonChip[] = []
  if (reasons.committedAt !== null) chips.push({ label: 'You committed', color: 'primary' })
  if (reasons.requested) chips.push({ label: 'Requested from you', color: 'primary' })
  if (reasons.othersCommitted > 0) {
    const others = reasons.othersCommitted === 1 ? '1 other' : `${reasons.othersCommitted} others`
    chips.push({ label: `${others} committed`, color: 'neutral' })
  }
  return chips
}

function reviewChips(reasons: ToReviewReasons): ReasonChip[] {
  if (reasons.unreviewedForMs === null) {
    return reasons.reviewerLogins.length === 0
      ? []
      : [{ label: `Reviewed by ${namedList(reasons.reviewerLogins)}`, color: 'neutral' }]
  }
  const chips: ReasonChip[] = [
    { label: `No review for ${formatElapsed(reasons.unreviewedForMs)}`, color: 'warning' },
  ]
  if (reasons.committedAt === null && reasons.othersCommitted === 0) {
    chips.push({ label: 'Nobody committed', color: 'warning' })
  }
  return chips
}

function fitChips(reasons: ToReviewReasons): ReasonChip[] {
  const chips: ReasonChip[] = []
  const matched = [...reasons.matchedSkills, ...reasons.matchedDomains]
  if (matched.length > 0) chips.push({ label: `Matches ${matched.join(', ')}`, color: 'neutral' })
  if (reasons.pastReviews > 0) {
    chips.push({ label: `You reviewed ${reasons.pastReviews} here`, color: 'neutral' })
  }
  if (reasons.authored > 0) {
    chips.push({ label: `You opened ${reasons.authored} here`, color: 'neutral' })
  }
  return chips
}

/** Why a pull request ranks where it does, as short labels, in the order the ranking weighs them. */
export function toReviewChips(reasons: ToReviewReasons): ReasonChip[] {
  return [...commitmentChips(reasons), ...reviewChips(reasons), ...fitChips(reasons)]
}
