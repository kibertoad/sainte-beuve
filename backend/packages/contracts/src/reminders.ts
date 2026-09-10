import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Review reminder wire contracts.
//
// A reminder is one scheduled nudge about one review request. Rows are written
// ahead of time by the policy in @sainte-beuve/reminders and fired by whatever
// the runtime uses for a tick (a Worker cron, a Node scheduler), so the two
// halves stay independent: the policy decides WHEN, the runtime decides HOW the
// clock is driven.
// ---------------------------------------------------------------------------

/**
 * What the nudge is for.
 *
 * `unassigned` chases a review nobody has taken; `pending` chases an assigned
 * reviewer who has not answered; `escalation` widens the audience once a review has
 * gone past its deadline, which is the point where a private nudge has demonstrably
 * not worked.
 */
export const reminderKindSchema = v.picklist(['unassigned', 'pending', 'escalation'])
export type ReminderKind = v.InferOutput<typeof reminderKindSchema>

/** Where the nudge is delivered. */
export const reminderChannelSchema = v.picklist(['slack_dm', 'slack_channel', 'github_comment'])
export type ReminderChannel = v.InferOutput<typeof reminderChannelSchema>

/**
 * `cancelled` is a real terminal state, not a delete: a review answered before its
 * nudge fired should leave a trace that the nudge was scheduled and became moot,
 * so cadence can be tuned against what actually happened.
 */
export const reminderStatusSchema = v.picklist(['scheduled', 'sent', 'cancelled', 'failed'])
export type ReminderStatus = v.InferOutput<typeof reminderStatusSchema>

export const reminderSchema = v.object({
  id: v.string(),
  reviewId: v.string(),
  kind: reminderKindSchema,
  channel: reminderChannelSchema,
  /** Reviewer the nudge is aimed at. Null for a channel-wide `unassigned` or `escalation`. */
  reviewerId: v.nullable(v.string()),
  dueAt: v.number(),
  status: reminderStatusSchema,
  sentAt: v.nullable(v.number()),
  /** Delivery failure text, kept so a silent channel misconfiguration is visible. */
  failureReason: v.nullable(v.string()),
  createdAt: v.number(),
})
export type Reminder = v.InferOutput<typeof reminderSchema>

/**
 * The cadence a workspace runs on, in milliseconds. Held as data rather than
 * constants so the escalation ladder can be tuned per deployment without a release,
 * and so the policy functions stay pure.
 */
export const reminderPolicySchema = v.object({
  /** Wait before chasing a review nobody has picked up. */
  unassignedAfterMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Wait before chasing an assigned reviewer who has not answered. */
  pendingAfterMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Gap between repeat `pending` nudges, until the review is answered or escalates. */
  pendingRepeatMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** How long past `dueAt` before the nudge goes wide. */
  escalateAfterDueMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Cap on `pending` nudges per review, so a stalled review cannot become a drumbeat. */
  maxPendingReminders: v.pipe(v.number(), v.integer(), v.minValue(0)),
})
export type ReminderPolicy = v.InferOutput<typeof reminderPolicySchema>
