import type { AttentionDecline, AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { type MatchTarget, affinityOf, wantsNothing } from './selection.js'

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
 * Without names the request is a broadcast to whoever fits it: the same share
 * of wanted skills and domains that ranks the recommendations and weights the
 * board's draw, held at `ATTENTION_FIT_FLOOR` or above.
 */

/**
 * The share of a broadcast's wanted skills and domains a person must hold to be
 * asked. Half keeps a `payments` ping off the screens of people who hold none
 * of it, while a backend engineer still hears about a change that wants backend
 * and frontend: the board would hand them that review too, only less often.
 */
export const ATTENTION_FIT_FLOOR = 0.5

/** Who a request is addressed to: by name, or by the gate. */
export interface AttentionAudienceRule {
  /** Reviewer ids asked by name. Non-empty replaces the fit and team gate. */
  recipientIds: readonly string[]
  /** What the ask wants. Nothing wanted addresses everybody who is available. */
  wanted: MatchTarget
  /** Whether the ask stays inside one team. */
  sameTeamOnly: boolean
  /** The team the gate is against. Null with `sameTeamOnly` set addresses nobody. */
  team: string | null
  /** Who raised it. They are never in their own audience. */
  requestedById: string
  /** Who turned it down. Out of the audience until they change their mind. */
  declinedIds: readonly string[]
}

/**
 * What an ask wants, as captured when it was raised: the mix its broadcast is
 * gated on and the next best match is ranked against.
 */
export function wantedOf(request: AttentionRequest): MatchTarget {
  return { skills: request.requiredSkills, domains: request.domains }
}

export function audienceRuleOf(request: AttentionRequest): AttentionAudienceRule {
  return {
    recipientIds: request.recipients.map((recipient) => recipient.reviewerId),
    wanted: wantedOf(request),
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
 * Why this person cannot be asked by anybody's ask, whoever it names or gates
 * on, or null when they can be: the requester never reaches themselves, and
 * somebody paused has said they cannot review right now.
 */
export function unaskableReason(
  reviewer: Reviewer,
  requestedById: string,
): 'requester' | 'paused' | null {
  if (reviewer.id === requestedById) return 'requester'
  if (reviewer.availability !== 'available') return 'paused'
  return null
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
  if (unaskableReason(reviewer, rule.requestedById) !== null) return false
  if (rule.declinedIds.includes(reviewer.id)) return false
  if (rule.recipientIds.length > 0) return rule.recipientIds.includes(reviewer.id)
  if (rule.sameTeamOnly && !isSameTeam(reviewer.team, rule.team)) return false
  return fitsWanted(reviewer, rule.wanted)
}

/** Whether a person holds enough of what a broadcast wants to be asked. */
export function fitsWanted(reviewer: Reviewer, wanted: MatchTarget): boolean {
  if (wantsNothing(wanted)) return true
  return affinityOf(reviewer, wanted) >= ATTENTION_FIT_FLOOR
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
 * Why this person cannot decline the ask, or null when they can: anybody it
 * reached, and anybody declining again with a new reason. Being named is
 * enough on its own, so somebody who paused after the ask went out can still
 * say no, and that no is what lets the ask move on.
 */
export function declineRefusal(
  request: AttentionRequest,
  reviewer: Reviewer,
): 'requester' | 'committed' | 'not_addressed' | null {
  if (request.requestedById === reviewer.id) return 'requester'
  if (request.commitments.some((entry) => entry.reviewerId === reviewer.id)) return 'committed'
  const reached =
    request.recipients.some((entry) => entry.reviewerId === reviewer.id) ||
    isInAttentionAudience(reviewer, audienceRuleOf(request)) ||
    hasDeclined(request, reviewer.id)
  return reached ? null : 'not_addressed'
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
