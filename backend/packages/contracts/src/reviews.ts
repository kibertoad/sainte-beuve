import * as v from 'valibot'
import { skillSchema } from './reviewers.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Review-request wire contracts.
//
// A review request is one pull request tracked through to a verdict. It is the
// aggregate everything else hangs off: assignments point at it, reminders fire
// against its clock, and an AI review run records what cat-factory said about it.
// ---------------------------------------------------------------------------

/**
 * Where a review request is in its life.
 *
 * `open` means tracked but unassigned: a request nobody has been handed yet, which
 * is exactly the state the reminder policy exists to shorten. The terminal three
 * (`approved`, `changes_requested`, `closed`) stop the reminder clock.
 */
const REVIEW_STATUSES = [
  'open',
  'assigned',
  'in_review',
  'approved',
  'changes_requested',
  'closed',
] as const
export const reviewStatusSchema = v.picklist(REVIEW_STATUSES)
export type ReviewStatus = v.InferOutput<typeof reviewStatusSchema>

// What each status is CALLED, in one place. Three surfaces render this
// vocabulary — the board, the Slack replies and the bot's comment — and every
// one of them was rendering the stored value, so a person read `in_review` and a
// screen reader read it letter by letter. Private table and exported reader, the
// shape `vcsDisplayName` already uses.
const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  open: 'Unassigned',
  assigned: 'Assigned',
  in_review: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  closed: 'Closed',
}

/**
 * The status as a person reads it.
 *
 * It takes a plain string and falls back to the value, because the API is
 * versioned separately from the SPA: a deployment serving a status this build
 * has never heard of has to render as itself rather than as `undefined`.
 */
export function reviewStatusLabel(status: string): string {
  return REVIEW_STATUS_LABELS[status as ReviewStatus] ?? status
}

/**
 * The statuses a board is ABOUT: the three a review can still move out of.
 *
 * One definition, because three callers now agree on it — the board route's
 * default, the SPA that reads it, and `/review list` in Slack — and a set
 * spelled out per caller is a set that drifts. It is the complement of the
 * terminal three above, which is what makes it the right default for a read
 * that would otherwise grow with everything the deployment has ever tracked:
 * an approved review from last quarter is history, not a board.
 */
export const ACTIVE_REVIEW_STATUSES: readonly ReviewStatus[] = ['open', 'assigned', 'in_review']

/**
 * EVERY status, which is the only way to ask a board read for history as well.
 *
 * Not the same as omitting the filter: the route reads a missing `status` as
 * the active three, so a caller that means "everything" has to say everything.
 * The screen with the "Show settled" switch is what needed it — sending no
 * status turned the switch into a no-op that re-read the same active list.
 */
export const ALL_REVIEW_STATUSES: readonly ReviewStatus[] = REVIEW_STATUSES

/** How urgently the review should be picked up. Drives the reminder cadence. */
export const reviewPrioritySchema = v.picklist(['low', 'normal', 'high'])
export type ReviewPriority = v.InferOutput<typeof reviewPrioritySchema>

export const reviewRequestSchema = v.object({
  id: v.string(),
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  authorLogin: v.string(),
  /** Skills a reviewer must have to be a candidate. Empty means anyone available. */
  requiredSkills: v.array(skillSchema),
  priority: reviewPrioritySchema,
  status: reviewStatusSchema,
  /** Reviewer ids currently on the hook, in assignment order. */
  assignedReviewerIds: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** When the review was first handed to someone. Null while `open`. */
  assignedAt: v.nullable(v.number()),
  /** Soft deadline the reminder policy escalates against. */
  dueAt: v.nullable(v.number()),
})
export type ReviewRequest = v.InferOutput<typeof reviewRequestSchema>

export const createReviewRequestSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: reviewRequestSchema.entries.title,
  authorLogin: v.string(),
  // A FACTORY default: valibot hands a plain default back by reference, so
  // every review parsed without the field would share one array.
  requiredSkills: v.optional(v.array(skillSchema), () => []),
  priority: v.optional(reviewPrioritySchema, 'normal'),
  dueAt: v.optional(v.nullable(v.number()), null),
})
export type CreateReviewRequest = v.InferOutput<typeof createReviewRequestSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateReviewRequestInput = v.InferInput<typeof createReviewRequestSchema>

/**
 * Ask the router for reviewers. `count` is how many people to put on the hook;
 * `excludeReviewerIds` is the caller's own veto list, on top of the author and
 * anyone already assigned, which the router excludes itself.
 */
export const assignReviewersSchema = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)), 1),
  excludeReviewerIds: v.optional(v.array(v.string()), () => []),
})
export type AssignReviewers = v.InferOutput<typeof assignReviewersSchema>

/**
 * Why fewer reviewers than requested came back.
 *
 * Five values rather than one because each names a different thing to go and do.
 * A single reason covering an empty directory, an all-paused pool, a skill nobody
 * holds and a candidate list emptied by the author exclusion can only be worded for
 * one of them, and it sends everybody else to fix something that was never wrong.
 */
export const shortfallReasonSchema = v.picklist([
  // The directory is empty.
  'no_reviewers',
  // Reviewers exist, but none of them is available.
  'none_available',
  // Somebody is available, but nobody available holds every required skill.
  'no_skill_match',
  // Somebody available holds the skills, and every one of them is the author or
  // is already on the review.
  'all_excluded',
  // The pool was smaller than the number asked for, so it ran out part way.
  'pool_exhausted',
])
export type ShortfallReason = v.InferOutput<typeof shortfallReasonSchema>

// What each reason is, and what to do about it, in one place: the bot's comment on
// the pull request and the board's toast are the same sentence with different tails,
// and two hand-written copies of it drifted the day they were written.
//
// The cause carries no terminal punctuation because the caller owns the middle: the
// bot says the review is on the board unassigned, a reroll says it stays where it is,
// and the board says neither. Private table and exported reader, the shape
// `vcsDisplayName` already uses.
const SHORTFALL_CAUSES: Record<ShortfallReason, string> = {
  no_reviewers: 'There is nobody in the reviewer pool yet',
  none_available: 'Everybody in the reviewer pool is paused',
  no_skill_match: 'Nobody available holds every skill this review needs',
  all_excluded: 'Everybody who could review this is already on it, or is the author',
  pool_exhausted: 'The pool ran out of people before it reached the number asked for',
}

const SHORTFALL_REMEDIES: Record<ShortfallReason, string | null> = {
  no_reviewers: 'Add somebody on the Reviewers screen.',
  none_available: 'Resume somebody, or add another reviewer.',
  no_skill_match: 'Add the skill to a reviewer, or drop it from the request.',
  all_excluded: null,
  pool_exhausted: null,
}

/** The cause as a clause, so a caller can follow it with the tail its channel needs. */
export function shortfallCause(reason: ShortfallReason): string {
  return SHORTFALL_CAUSES[reason]
}

/** What to do about it, as a full sentence, or null where there is nothing to suggest. */
export function shortfallRemedy(reason: ShortfallReason): string | null {
  return SHORTFALL_REMEDIES[reason]
}

/** A person on the hook, named. The id alone is not something anybody can read. */
export const assignedReviewerSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
})
export type AssignedReviewer = v.InferOutput<typeof assignedReviewerSchema>

/**
 * A review as the BOARD reads it: the stored aggregate plus the names of the
 * people on it.
 *
 * A read model rather than a wider `ReviewRequest`, because the names are not
 * part of the aggregate: they live on the reviewer rows, they change when
 * somebody is renamed, and writing them onto the review would be a second copy
 * to keep in step for a fact the directory already holds. The board is the one
 * reader that needs them — a row whose whole purpose is "who has this" cannot
 * show an opaque id — so the join happens on the way out, once per read.
 */
export const boardReviewSchema = v.object({
  ...reviewRequestSchema.entries,
  /**
   * The people on the hook, in assignment order, for the ids in
   * `assignedReviewerIds`. An id whose reviewer has since been removed from the
   * directory is absent rather than invented, so the two lists can differ in
   * length and the row says what it can.
   */
  assignedReviewers: v.array(assignedReviewerSchema),
})
export type BoardReview = v.InferOutput<typeof boardReviewSchema>

export const assignReviewersResultSchema = v.object({
  review: reviewRequestSchema,
  /** The reviewers this call added, in the order the router picked them. */
  assigned: v.array(assignedReviewerSchema),
  /** Why fewer reviewers than requested came back. Null on a full match. */
  shortfallReason: v.nullable(shortfallReasonSchema),
})
export type AssignReviewersResult = v.InferOutput<typeof assignReviewersResultSchema>

export const updateReviewStatusSchema = v.object({ status: reviewStatusSchema })
export type UpdateReviewStatus = v.InferOutput<typeof updateReviewStatusSchema>
