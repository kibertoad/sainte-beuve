import type { BoardReview } from '@sainte-beuve/contracts'

// How a board row reads its own clock.
//
// The board's purpose is "what has this deployment taken responsibility for",
// and the two facts that answer it are how long a review has sat and whether it
// is past its deadline. Both were on the wire and neither was on the screen.
//
// Pure and auto-imported, like the form rules beside them, so the wording has a
// suite instead of being checked by opening the page on a Tuesday.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The units, largest first: the first one that fits is the one somebody says. */
const UNITS: readonly { readonly ms: number; readonly name: string }[] = [
  { ms: DAY, name: 'day' },
  { ms: HOUR, name: 'hour' },
  { ms: MINUTE, name: 'minute' },
]

/**
 * How long ago, in the one unit a person would use: `3 days`, `2 hours`, `just now`.
 *
 * Coarse on purpose. The question a board row answers is "has this been ignored",
 * and `3 days` answers it where `3 days 4 hours 12 minutes` makes somebody read a
 * timestamp to learn the same thing. A moment in the FUTURE — a clock skewed
 * between the browser and the API, which happens — reads as `just now` rather
 * than as a negative age.
 */
export function relativeAge(since: number, now: number): string {
  const elapsed = now - since
  for (const unit of UNITS) {
    const count = Math.floor(elapsed / unit.ms)
    if (count >= 1) return `${count} ${unit.name}${count === 1 ? '' : 's'}`
  }
  return 'just now'
}

/** How a deadline reads: overdue, due soon, or nothing worth a badge. */
export type DueState = 'overdue' | 'due' | null

/**
 * Whether the deadline is worth saying out loud.
 *
 * Three states rather than a date, because a date is a thing to work out and
 * this is a thing to act on. Nothing at all for a review whose deadline is days
 * away: a badge on every row is a badge nobody reads, and the point of the
 * marker is that the rows carrying one stand out from the rows that do not.
 */
export function dueState(review: Pick<BoardReview, 'dueAt'>, now: number): DueState {
  if (review.dueAt === null) return null
  if (review.dueAt <= now) return 'overdue'
  return review.dueAt - now <= DAY ? 'due' : null
}

/** What the due marker says, for the state above. */
export function dueLabel(state: Exclude<DueState, null>, review: BoardReview, now: number): string {
  return state === 'overdue'
    ? `${relativeAge(review.dueAt ?? now, now)} overdue`
    : 'due within a day'
}
