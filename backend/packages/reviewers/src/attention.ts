import type { AttentionDecline, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { hasAllSkills } from './selection.js'

/**
 * Who an attention request is addressed to, and when it has been answered.
 *
 * Pure, and here rather than in a service, because it is a DECISION over data:
 * the same predicate decides who gets pushed an event, who sees the request in
 * their inbox on a page opened an hour later, and who is allowed to commit to
 * it. Three code paths reading three different rules is how somebody comes to
 * be pinged about work they are then refused.
 *
 * A request either names its audience or derives it. Named recipients are
 * the audience exactly: the requester picked them, usually off the ranked
 * recommendations, and a skill list is not in a position to overrule that.
 * Without names the request is a broadcast, and the skill and team gate is what
 * keeps a `payments` ping off the screens of people who hold none of it.
 */

/** Who a request is addressed to: by name, or by the gate. */
export interface AttentionAudienceRule {
  /** Reviewer ids asked by name. Non-empty replaces the skill and team gate. */
  recipientIds: readonly string[]
  /** Skills a person must ALL have. Empty addresses everybody who is available. */
  requiredSkills: readonly string[]
  /** Whether the ask stays inside one team. */
  sameTeamOnly: boolean
  /** The team the gate is against. Null with `sameTeamOnly` set addresses nobody. */
  team: string | null
  /** Who raised it. They are never in their own audience. */
  requestedById: string
  /** Who turned it down. Out of the audience until they change their mind. */
  declinedIds: readonly string[]
}

export function audienceRuleOf(request: AttentionRequest): AttentionAudienceRule {
  return {
    recipientIds: request.recipients.map((recipient) => recipient.reviewerId),
    requiredSkills: request.requiredSkills,
    sameTeamOnly: request.sameTeamOnly,
    team: request.team,
    requestedById: request.requestedById,
    declinedIds: request.declines.map((decline) => decline.reviewerId),
  }
}

/** Case-insensitive team comparison, for the same reason handles are compared that way. */
function isSameTeam(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Whether this person should be asked.
 *
 * `availability` is the only load-shaped gate applied, and `weight` deliberately
 * is not: a weight of 0 says "do not route work to me automatically", which is a
 * statement about the router's draw and not a refusal to be asked. Someone
 * paused, on the other hand, has said they cannot review right now, and a ping
 * is exactly what they asked not to receive, even on an ask that names them.
 */
export function isInAttentionAudience(reviewer: Reviewer, rule: AttentionAudienceRule): boolean {
  if (reviewer.id === rule.requestedById) return false
  if (reviewer.availability !== 'available') return false
  if (rule.declinedIds.includes(reviewer.id)) return false
  if (rule.recipientIds.length > 0) return rule.recipientIds.includes(reviewer.id)
  if (rule.sameTeamOnly && !isSameTeam(reviewer.team, rule.team)) return false
  return hasAllSkills(reviewer, rule.requiredSkills)
}

/** Everybody the request is addressed to, in directory order. */
export function selectAttentionAudience(
  candidates: readonly Reviewer[],
  rule: AttentionAudienceRule,
): Reviewer[] {
  return candidates.filter((reviewer) => isInAttentionAudience(reviewer, rule))
}

/**
 * Whether the critical mass has assembled.
 *
 * Compared with `>=` rather than `===` so that a request whose target was
 * lowered after two people committed is answered rather than stuck waiting for
 * a third that can never make the count equal.
 */
export function isAttentionSatisfied(request: {
  neededCommitments: number
  commitments: readonly unknown[]
}): boolean {
  return request.commitments.length >= request.neededCommitments
}

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

/**
 * Everybody the ask has already been to, one way or another: the requester,
 * every named recipient, whoever committed and whoever declined. Asking on
 * goes to somebody outside this set, so nobody is asked twice.
 */
export function askedOrAnsweredIds(request: AttentionRequest): Set<string> {
  return new Set([
    request.requestedById,
    ...request.recipients.map((entry) => entry.reviewerId),
    ...request.commitments.map((entry) => entry.reviewerId),
    ...request.declines.map((entry) => entry.reviewerId),
  ])
}

/** Whether this person has turned the ask down. */
export function hasDeclined(request: AttentionRequest, reviewerId: string): boolean {
  return request.declines.some((entry) => entry.reviewerId === reviewerId)
}

/**
 * The declines with this one recorded. A second decline from the same person
 * replaces the first, so a changed reason is kept and nobody is counted twice.
 */
export function withDecline(
  declines: readonly AttentionDecline[],
  decline: AttentionDecline,
): AttentionDecline[] {
  return [...declines.filter((entry) => entry.reviewerId !== decline.reviewerId), decline]
}

/** The declines without this person's, for somebody who changed their mind and committed. */
export function withoutDecline(
  declines: readonly AttentionDecline[],
  reviewerId: string,
): AttentionDecline[] {
  return declines.filter((entry) => entry.reviewerId !== reviewerId)
}
