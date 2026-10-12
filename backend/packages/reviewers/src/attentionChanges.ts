import type {
  AttentionCommitment,
  AttentionDecline,
  AttentionDelivery,
  AttentionRequest,
  Reviewer,
} from '@sainte-beuve/contracts'
import { MAX_ATTENTION_RECIPIENTS, recipientShortfall } from '@sainte-beuve/contracts'
import {
  askedOrAnsweredIds,
  hasDeclined,
  isAttentionSatisfied,
  withDecline,
  withoutDecline,
} from './attention.js'

/**
 * What one answer changes on an ask, worked out from the ask as stored.
 *
 * Each function reads only the stored ask and what the caller hands it, and
 * names only the fields it changes. Two answers landing together then each
 * build on the row as the store holds it rather than on a read taken before
 * the other landed, and the store can rerun a decision against a fresher row.
 */

export type AttentionPatch = Partial<AttentionRequest>

/** A change that may name new people, and who they are, so they can be told. */
export interface AttentionChange {
  patch: AttentionPatch
  asked: Reviewer[]
}

/**
 * Up to `count` of `candidates`, in their order, that the ask has not been to
 * yet, and never more than it still has room to name. Nobody on an ask that
 * closed while the change was worked out, so nobody is DMed about one.
 */
export function nextToAsk(
  request: AttentionRequest,
  candidates: readonly Reviewer[],
  count: number,
): Reviewer[] {
  if (request.status !== 'open') return []
  const room = Math.min(count, MAX_ATTENTION_RECIPIENTS - request.recipients.length)
  if (room <= 0) return []
  const taken = askedOrAnsweredIds(request)
  const fresh: Reviewer[] = []
  for (const reviewer of candidates) {
    if (fresh.length === room) break
    if (taken.has(reviewer.id)) continue
    taken.add(reviewer.id)
    fresh.push(reviewer)
  }
  return fresh
}

/**
 * One more commitment. It resolves an ask that is still open once the count
 * is reached, and clears the person's decline when they changed their mind.
 * A commitment already on the ask is kept once.
 */
export function commitmentChange(
  request: AttentionRequest,
  commitment: AttentionCommitment,
): AttentionPatch {
  const commitments = [
    ...request.commitments.filter((entry) => entry.reviewerId !== commitment.reviewerId),
    commitment,
  ]
  const resolves = request.status === 'open' && isAttentionSatisfied({ ...request, commitments })
  return {
    commitments,
    updatedAt: commitment.committedAt,
    ...(resolves ? { status: 'resolved', resolvedAt: commitment.committedAt } : {}),
    ...(hasDeclined(request, commitment.reviewerId)
      ? { declines: withoutDecline(request.declines, commitment.reviewerId) }
      : {}),
  }
}

/**
 * A decline, and on an ask that keeps asking, as many of `candidates` as the
 * declines leave it short.
 */
export function declineChange(
  request: AttentionRequest,
  decline: AttentionDecline,
  candidates: readonly Reviewer[],
): AttentionChange {
  const declined = { ...request, declines: withDecline(request.declines, decline) }
  const asked = declined.keepAsking
    ? nextToAsk(declined, candidates, recipientShortfall(declined))
    : []
  return {
    patch: {
      declines: declined.declines,
      updatedAt: decline.declinedAt,
      ...recipientsAdded(request, asked),
    },
    asked,
  }
}

/** Up to `count` of `candidates` added to the people the ask names. */
export function askMoreChange(
  request: AttentionRequest,
  candidates: readonly Reviewer[],
  count: number,
  at: number,
): AttentionChange {
  const asked = nextToAsk(request, candidates, count)
  return { patch: { updatedAt: at, ...recipientsAdded(request, asked) }, asked }
}

/** Where the DMs to the people just asked landed, kept alongside the ones already sent. */
export function deliveriesChange(
  request: AttentionRequest,
  delivered: readonly AttentionDelivery[],
): AttentionPatch {
  return { chatDeliveries: [...request.chatDeliveries, ...delivered] }
}

function recipientsAdded(request: AttentionRequest, asked: readonly Reviewer[]): AttentionPatch {
  if (asked.length === 0) return {}
  return {
    recipients: [
      ...request.recipients,
      ...asked.map((reviewer) => ({ reviewerId: reviewer.id, displayName: reviewer.displayName })),
    ],
  }
}
