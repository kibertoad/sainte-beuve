import * as v from 'valibot'
import { roleSchema } from './orgs.js'
import { NO_VCS_HANDLES, vcsHandlesSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Reviewer wire contracts.
//
// A reviewer is a person the router may hand a pull request to, and the
// canonical person the workspace renders for. The row carries the three things
// selection needs (what they can review, whether they can review at all right
// now, and how much of the load they should take) plus how to reach them.
// Identity is deliberately split per system: a handle on each source-control
// host and a Slack user id are different namespaces, and a reviewer may be
// reachable in one without the others.
// ---------------------------------------------------------------------------

/** A skill tag. Free-form on purpose: teams name their own areas ('typescript', 'payments'). */
export const skillSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))
export type Skill = v.InferOutput<typeof skillSchema>

/**
 * Whether a reviewer is selectable. `paused` is the self-serve state (heads-down,
 * on-call, holiday) and keeps the row intact so the reviewer reappears with their
 * skills when they flip back.
 */
export const reviewerAvailabilitySchema = v.picklist(['available', 'paused'])
export type ReviewerAvailability = v.InferOutput<typeof reviewerAvailabilitySchema>

export const reviewerSchema = v.object({
  id: v.string(),
  displayName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  /** The person's handle on each host. Empty when they are only reachable in chat. */
  handles: vcsHandlesSchema,
  /** Slack user id (`U…`), the address reminders are delivered to. */
  slackUserId: v.nullable(v.string()),
  /**
   * The team this person belongs to. Free-form, like a skill, and nullable
   * because a directory is useful before anybody has drawn the org chart. It is
   * a GATE rather than a label: an attention request can ask to stay inside the
   * requester's own team, and a reviewer with no team is then outside everyone's.
   */
  team: v.nullable(v.string()),
  skills: v.array(skillSchema),
  availability: reviewerAvailabilitySchema,
  /**
   * What this person may do in their org. It is here rather than on a membership
   * table of its own because the reviewer row IS the membership: a person exists
   * in exactly one org's directory, and a second table would be a second row to
   * keep in step for one fact.
   *
   * `member` for a row that predates the field, which is why the migration
   * backfills the rows that already existed to `admin` instead of leaning on
   * this default: a deployment upgrading into the boundary must not wake up with
   * a Configuration screen nobody can reach.
   */
  role: v.optional(roleSchema, 'member'),
  /**
   * Relative share of the review load. A 0.5 reviewer is picked about half as often
   * as a 1.0 one at equal outstanding load: the lever for part-time members and for
   * people ramping up on a codebase.
   *
   * 0 is EXCLUDED, and by the check rather than only by the comment. `isEligible`
   * drops a reviewer at or below 0, so a stored 0 is a person who never comes up
   * again while their row still reads as available.
   */
  weight: v.pipe(
    v.number(),
    v.check((weight) => weight > 0, "A reviewer's weight has to be above 0"),
    v.maxValue(10),
  ),
  /** Reviews currently assigned and not yet resolved. Selection reads it; nothing else does. */
  outstandingReviews: v.pipe(v.number(), v.integer(), v.minValue(0)),
  createdAt: v.number(),
})
export type Reviewer = v.InferOutput<typeof reviewerSchema>

// The object and array defaults below are FACTORIES. Valibot hands a plain
// default value back by reference, so every row parsed without the field would
// share one map and one array with every other, and the first caller to write
// into what it was given would change the shape of rows it never saw.
export const createReviewerSchema = v.object({
  displayName: reviewerSchema.entries.displayName,
  handles: v.optional(vcsHandlesSchema, () => ({ ...NO_VCS_HANDLES })),
  slackUserId: v.optional(v.nullable(v.string()), null),
  team: v.optional(v.nullable(v.string()), null),
  skills: v.optional(v.array(skillSchema), () => []),
  availability: v.optional(reviewerAvailabilitySchema, 'available'),
  role: v.optional(roleSchema, 'member'),
  weight: v.optional(reviewerSchema.entries.weight, 1),
})
export type CreateReviewer = v.InferOutput<typeof createReviewerSchema>
/**
 * What a CALLER sends: the same schema before its defaults are applied, so the
 * optional fields are actually optional. A client typed against the output form
 * would have to send every default by hand.
 */
export type CreateReviewerInput = v.InferInput<typeof createReviewerSchema>

export const updateReviewerSchema = v.partial(
  v.object({
    displayName: reviewerSchema.entries.displayName,
    /** Replaces the whole map: a patch naming one host clears the other. */
    handles: vcsHandlesSchema,
    slackUserId: v.nullable(v.string()),
    team: v.nullable(v.string()),
    skills: v.array(skillSchema),
    availability: reviewerAvailabilitySchema,
    role: roleSchema,
    weight: reviewerSchema.entries.weight,
  }),
)
export type UpdateReviewer = v.InferOutput<typeof updateReviewerSchema>
