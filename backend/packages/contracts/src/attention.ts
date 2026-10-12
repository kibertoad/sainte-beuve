import * as v from 'valibot'
import { pullRequestPeopleSchema } from './recommendations.js'
import { skillSchema } from './reviewers.js'
import { pullRequestRefSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Asking for attention on a pull request.
//
// This is the one thing the workspace does that a pull-request list cannot: it
// turns "somebody please look at this" into an addressed ask. The requester
// either names the people to ask, usually picked from the ranked
// recommendations, or leaves the audience to be derived from the skills and
// domains the change needs and, optionally, from their own team.
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

/** The most people one ask can name. Past this it is a broadcast, and the gate is the tool for that. */
export const MAX_ATTENTION_RECIPIENTS = 10

/**
 * A person the ask was addressed to by name. The display name is captured
 * with the id so every inbox can say who was asked without a directory read.
 */
export const attentionRecipientSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
})
export type AttentionRecipient = v.InferOutput<typeof attentionRecipientSchema>

/**
 * Somebody the ask reached saying they will not take it. Recorded rather than
 * inferred from silence, so the requester can tell a no from an unread ask.
 */
export const attentionDeclineSchema = v.object({
  reviewerId: v.string(),
  displayName: v.string(),
  reason: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(300))),
  declinedAt: v.number(),
})
export type AttentionDecline = v.InferOutput<typeof attentionDeclineSchema>

/**
 * A chat message an ask was delivered as, kept so the message can be updated
 * when the ask resolves or is withdrawn, rather than keep offering a button on
 * an ask that is closed. The conversation is the DM's own id, not the person's.
 */
export const attentionDeliverySchema = v.object({
  reviewerId: v.string(),
  conversationId: v.string(),
  messageId: v.string(),
})
export type AttentionDelivery = v.InferOutput<typeof attentionDeliverySchema>

export const attentionRequestSchema = v.object({
  id: v.string(),
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
  /** Who asked. A reviewer id, because the requester is a person in the directory. */
  requestedById: v.string(),
  requestedByName: v.string(),
  /**
   * The people asked by name. When there are any, they ARE the audience, and
   * the fit and team gate below does not apply. A factory default, so a
   * request stored before names existed decodes as a gated one.
   */
  recipients: v.optional(v.array(attentionRecipientSchema), () => []),
  /** The chat DMs the named recipients were sent. A factory default, like `recipients`. */
  chatDeliveries: v.optional(v.array(attentionDeliverySchema), () => []),
  /** Who said no, and why when they said. A factory default, like `recipients`. */
  declines: v.optional(v.array(attentionDeclineSchema), () => []),
  /**
   * Whether a decline that leaves a named ask short asks the next best match
   * by itself. Off, the requester is shown the shortfall and asks on.
   */
  keepAsking: v.optional(v.boolean(), false),
  /**
   * The pull request's author and requested reviewers as the host listed them
   * when the ask was raised, so the people it moves on to leave them out even
   * when the board has no row for it. Null when the requester did not send them.
   */
  people: v.optional(v.nullable(pullRequestPeopleSchema), null),
  /**
   * The skills the ask wants: the ones the requester picked, or else the pull
   * request's own, captured when it was raised. With `domains`, the mix a
   * broadcast is matched against and the next best match is ranked against.
   */
  requiredSkills: v.array(skillSchema),
  /**
   * The repository's domains when the ask was raised, matched alongside the
   * skills. A factory default, so a request stored before domains counted
   * decodes as one that wants none.
   */
  domains: v.optional(v.array(skillSchema), () => []),
  /**
   * Whether the ask stays inside one team. On a named ask it gates nobody: it
   * says the ranked list the names came from was kept to the team, and the
   * next best match an ask moves on to is drawn from the same list.
   */
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

// How far an ask is from answered. Here beside the model rather than in
// @sainte-beuve/reviewers because the SPA says the same thing about the same
// ask, and two copies of the rule are how its button and the server disagree.

/** How many more people the request is still waiting for. Never negative. */
export function outstandingCommitments(request: {
  neededCommitments: number
  commitments: readonly unknown[]
}): number {
  return Math.max(0, request.neededCommitments - request.commitments.length)
}

/**
 * The named recipients who could still answer: neither committed nor declined.
 * Empty for an ask sent by skill, which names nobody.
 */
export function pendingRecipientIds(request: AttentionRequest): string[] {
  const answered = new Set([
    ...request.commitments.map((entry) => entry.reviewerId),
    ...request.declines.map((entry) => entry.reviewerId),
  ])
  return request.recipients
    .map((recipient) => recipient.reviewerId)
    .filter((reviewerId) => !answered.has(reviewerId))
}

/**
 * How many more people a NAMED ask has to ask before it can resolve at all:
 * what it still waits for, less the recipients who have not answered yet.
 * Zero for an ask sent by skill, whose audience is whoever holds the skills,
 * and zero while enough named people are still to answer.
 */
export function recipientShortfall(request: AttentionRequest): number {
  if (request.recipients.length === 0) return 0
  return Math.max(0, outstandingCommitments(request) - pendingRecipientIds(request).length)
}

export const createAttentionRequestSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: attentionRequestSchema.entries.title,
  /**
   * Reviewer ids to ask by name. Each must be in the directory, available and
   * not the requester, and there must be at least as many as `neededCommitments`.
   */
  recipientIds: v.optional(
    v.pipe(v.array(v.string()), v.maxLength(MAX_ATTENTION_RECIPIENTS)),
    () => [],
  ),
  // A FACTORY default: valibot hands a plain default back by reference, so
  // every ask parsed without the field would share one array.
  requiredSkills: v.optional(v.array(skillSchema), () => []),
  sameTeamOnly: v.optional(v.boolean(), false),
  neededCommitments: v.optional(attentionRequestSchema.entries.neededCommitments, 1),
  note: v.optional(v.nullable(attentionRequestSchema.entries.note), null),
  keepAsking: v.optional(v.boolean(), false),
  /**
   * What the host lists for the pull request, as the recommendations take it.
   * Its author cannot be named, and asking on leaves out everybody it lists.
   */
  people: v.optional(v.nullable(pullRequestPeopleSchema), null),
})
export type CreateAttentionRequest = v.InferOutput<typeof createAttentionRequestSchema>
/** What a CALLER sends: the schema before defaults, so the optional fields are optional. */
export type CreateAttentionRequestInput = v.InferInput<typeof createAttentionRequestSchema>

/**
 * Turning an ask down. The reason is optional and shown to the requester; a
 * blank one is no reason, so it reads as null.
 */
export const declineAttentionRequestSchema = v.object({
  reason: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.maxLength(300),
        v.transform((reason) => (reason === '' ? null : reason)),
      ),
    ),
    null,
  ),
})
export type DeclineAttentionRequest = v.InferOutput<typeof declineAttentionRequestSchema>

/**
 * The requester asking more people on an open ask. Named ids are asked as
 * given; none asks the next best matches, as many as the ask is short.
 */
export const askMoreAttentionRequestSchema = v.object({
  recipientIds: v.optional(
    v.pipe(v.array(v.string()), v.maxLength(MAX_ATTENTION_RECIPIENTS)),
    () => [],
  ),
})
export type AskMoreAttentionRequest = v.InferOutput<typeof askMoreAttentionRequestSchema>
/** What a CALLER sends. */
export type AskMoreAttentionRequestInput = v.InferInput<typeof askMoreAttentionRequestSchema>

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
 * queue of work somebody else already took. `declined` takes it off the
 * decliner's screen and tells the requester; `asked` puts it on the screens of
 * the people added to it.
 */
export const attentionEventKindSchema = v.picklist([
  'opened',
  'committed',
  'declined',
  'asked',
  'resolved',
  'cancelled',
])
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
  /**
   * The handle this commitment requested on the host, or null when the request
   * there is somebody else's or was never made. Releasing the commitment takes
   * back only this request. Absent on rows stored before the host was told.
   */
  requestedHandle: v.optional(v.nullable(v.string()), null),
  createdAt: v.number(),
})
export type ReviewCommitment = v.InferOutput<typeof reviewCommitmentSchema>

/** Commit to reviewing a pull request nobody asked about through an attention request. */
export const createReviewCommitmentSchema = v.object({
  pullRequest: pullRequestRefSchema,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
})
export type CreateReviewCommitment = v.InferOutput<typeof createReviewCommitmentSchema>
