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
export const reviewStatusSchema = v.picklist([
  'open',
  'assigned',
  'in_review',
  'approved',
  'changes_requested',
  'closed',
])
export type ReviewStatus = v.InferOutput<typeof reviewStatusSchema>

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

export const assignReviewersResultSchema = v.object({
  review: reviewRequestSchema,
  /** The reviewers this call added, in the order the router picked them. */
  assigned: v.array(v.object({ reviewerId: v.string(), displayName: v.string() })),
  /**
   * Why fewer reviewers than requested came back, when that happened: the pool ran
   * out of candidates with the required skills. Null on a full match.
   */
  shortfallReason: v.nullable(v.picklist(['no_candidates', 'pool_exhausted'])),
})
export type AssignReviewersResult = v.InferOutput<typeof assignReviewersResultSchema>

export const updateReviewStatusSchema = v.object({ status: reviewStatusSchema })
export type UpdateReviewStatus = v.InferOutput<typeof updateReviewStatusSchema>
