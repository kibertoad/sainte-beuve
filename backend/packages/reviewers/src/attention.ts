import type { AttentionRequest, Reviewer } from '@sainte-beuve/contracts'
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
 * It shares the skill gate with reviewer selection deliberately. A ping that
 * used a looser rule than the router would send a `payments` change to people
 * the router would never have picked for it.
 */

/** The gate, without the "who is asking" part that only a request carries. */
export interface AttentionAudienceRule {
  /** Skills a person must ALL have. Empty addresses everybody who is available. */
  requiredSkills: readonly string[]
  /** Whether the ask stays inside one team. */
  sameTeamOnly: boolean
  /** The team the gate is against. Null with `sameTeamOnly` set addresses nobody. */
  team: string | null
  /** Who raised it. They are never in their own audience. */
  requestedById: string
}

export function audienceRuleOf(request: AttentionRequest): AttentionAudienceRule {
  return {
    requiredSkills: request.requiredSkills,
    sameTeamOnly: request.sameTeamOnly,
    team: request.team,
    requestedById: request.requestedById,
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
 * is exactly what they asked not to receive.
 */
export function isInAttentionAudience(reviewer: Reviewer, rule: AttentionAudienceRule): boolean {
  if (reviewer.id === rule.requestedById) return false
  if (reviewer.availability !== 'available') return false
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
