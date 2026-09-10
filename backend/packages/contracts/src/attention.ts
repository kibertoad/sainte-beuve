import * as v from 'valibot'
import { skillSchema } from './reviewers.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Asking for attention on a pull request.
//
// This is the one thing the workspace does that a pull-request list cannot: it
// turns "somebody please look at this" into an addressed ask. The audience is
// derived rather than named, from the skills the change needs and, optionally,
// from the requester's own team, so nobody has to know who is free.
//
// It RESOLVES itself. Once enough people have said they will review, the
// request is answered and disappears from everybody's inbox, including the
// people who never got round to it. An ask that stayed up after it was answered
// would train the whole team to ignore the next one.
// ---------------------------------------------------------------------------

/**
 * `resolved` means the critical mass assembled; `cancelled` means the requester
 * withdrew, or the pull request stopped needing eyes. They are separate states
 * because only one of them says anything about the team.
 */
export const attentionStatusSchema = v.picklist(['open', 'resolved', 'cancelled'])
export type AttentionStatus = v.InferOutput<typeof attentionStatusSchema>

/** One person saying they will review it. */
export const attentionCommitmentSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
  committedAt: v.number(),
})
export type AttentionCommitment = v.InferOutput<typeof attentionCommitmentSchema>

/** The most people one ask can wait for, so a typo cannot make a request unresolvable. */
export const MAX_NEEDED_COMMITMENTS = 5

export const attentionRequestSchema = v.object({
  id: v.string(),
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  /** Who asked. A reviewer id, because the requester is a person in the directory. */
  requestedById: v.string(),
  requestedByName: v.string(),
  /** Skills a person must ALL have to be in the audience. Empty means everybody available. */
  requiredSkills: v.array(skillSchema),
  /** Whether the ask stays inside one team. */
  sameTeamOnly: v.boolean(),
  /**
   * The team the gate is against, captured when the request was raised. Stored
   * rather than read off the requester at delivery time, so somebody changing
   * team does not silently re-address an ask that is already out.
   */
  team: v.nullable(v.string()),
  /** How many commitments answer it. Reaching this resolves the request. */
  neededCommitments: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(MAX_NEEDED_COMMITMENTS),
  ),
  commitments: v.array(attentionCommitmentSchema),
  /** Anything the requester wants the reviewer to know before they open it. */
  note: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
  status: attentionStatusSchema,
  createdAt: v.number(),
  updatedAt: v.number(),
  resolvedAt: v.nullable(v.number()),
})
export type AttentionRequest = v.InferOutput<typeof attentionRequestSchema>

export const createAttentionRequestSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: attentionRequestSchema.entries.title,
  // A FACTORY default: valibot hands a plain default back by reference, so
  // every ask parsed without the field would share one array.
  requiredSkills: v.optional(v.array(skillSchema), () => []),
  sameTeamOnly: v.optional(v.boolean(), false),
  neededCommitments: v.optional(attentionRequestSchema.entries.neededCommitments, 1),
  note: v.optional(v.nullable(attentionRequestSchema.entries.note), null),
})
export type CreateAttentionRequest = v.InferOutput<typeof createAttentionRequestSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateAttentionRequestInput = v.InferInput<typeof createAttentionRequestSchema>

/**
 * What the inbox holds, and what the stream pushes.
 *
 * The two delivery paths carry the SAME payload on purpose. A page opened an
 * hour late fetches the list over REST and a page already open is pushed the
 * event, and if those two shapes drifted the second reader would be looking at
 * a different product from the first.
 */
export const attentionInboxSchema = v.object({
  requests: v.array(attentionRequestSchema),
})
export type AttentionInbox = v.InferOutput<typeof attentionInboxSchema>

/**
 * `resolved` and `cancelled` are pushed as well as `opened`, because the point
 * of the stream is that a request DISAPPEARS the moment it is answered. A stream
 * that only announced new asks would leave every other reader looking at a
 * queue of work somebody else already took.
 */
export const attentionEventKindSchema = v.picklist(['opened', 'committed', 'resolved', 'cancelled'])
export type AttentionEventKind = v.InferOutput<typeof attentionEventKindSchema>

export const attentionEventSchema = v.object({
  kind: attentionEventKindSchema,
  request: attentionRequestSchema,
})
export type AttentionEvent = v.InferOutput<typeof attentionEventSchema>

/**
 * A commitment the workspace tracks, whether or not an attention request
 * produced it: "I will review this" is worth recording when somebody picks a
 * pull request off a list too, and it is what the third workspace column reads.
 */
export const reviewCommitmentSchema = v.object({
  id: v.string(),
  reviewerId: v.string(),
  pullRequest: pullRequestRefSchema,
  title: v.string(),
  /** The ask this answered, when it answered one. */
  attentionRequestId: v.nullable(v.string()),
  createdAt: v.number(),
})
export type ReviewCommitment = v.InferOutput<typeof reviewCommitmentSchema>

/** Commit to reviewing a pull request nobody asked about through an attention request. */
export const createReviewCommitmentSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
})
export type CreateReviewCommitment = v.InferOutput<typeof createReviewCommitmentSchema>
