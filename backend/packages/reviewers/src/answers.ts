import type {
  AttentionCommitment,
  AttentionRequest,
  AttentionStatus,
} from '@sainte-beuve/contracts'
import { isAttentionSatisfied } from './attention.js'

/**
 * What answering an ask does to it, decided over the ask as stored.
 *
 * Pure so the store can call it again when another answer landed between its
 * read and its write: the decision is remade against the request that won,
 * never against the one this caller happened to read first.
 */

/** The fields an answer writes. */
export type AnswerPatch = Pick<AttentionRequest, 'status' | 'updatedAt'> &
  Partial<Pick<AttentionRequest, 'commitments' | 'resolvedAt'>>

export type CommitDecision =
  | { kind: 'commit'; patch: AnswerPatch; resolves: boolean }
  /** They already said yes: a second click is answered, not refused. */
  | { kind: 'already' }
  /** The requester's own commitment would resolve their ask with nobody on it. */
  | { kind: 'requester' }
  | { kind: 'closed'; status: AttentionStatus }

/**
 * "I will review it", against the ask as it stands.
 *
 * Their own commitment is answered before the status is, and the order is the
 * whole point: with the default critical mass of one, the click that resolved
 * the ask makes the next click from the same person a click on a resolved ask.
 * Refusing it would tell the one person who did commit that they could not.
 */
export function decideCommit(
  request: AttentionRequest,
  committer: Omit<AttentionCommitment, 'committedAt'>,
  now: number,
): CommitDecision {
  if (request.requestedById === committer.reviewerId) return { kind: 'requester' }
  if (request.commitments.some((entry) => entry.reviewerId === committer.reviewerId)) {
    return { kind: 'already' }
  }
  if (request.status !== 'open') return { kind: 'closed', status: request.status }
  const commitments = [...request.commitments, { ...committer, committedAt: now }]
  const resolves = isAttentionSatisfied({ ...request, commitments })
  return {
    kind: 'commit',
    resolves,
    patch: {
      commitments,
      status: resolves ? 'resolved' : 'open',
      updatedAt: now,
      resolvedAt: resolves ? now : null,
    },
  }
}

/** The requester withdrawing: only an open ask changes. */
export function decideCancel(request: AttentionRequest, now: number): AnswerPatch | null {
  if (request.status !== 'open') return null
  return { status: 'cancelled', updatedAt: now }
}
