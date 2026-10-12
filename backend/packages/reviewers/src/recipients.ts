import type { Reviewer } from '@sainte-beuve/contracts'
import { unaskableReason } from './attention.js'

/**
 * The people an ask names, checked when it is raised.
 *
 * Each name has to be somebody the ask can reach: in the directory, and not
 * excluded by the rule `isInAttentionAudience` applies at delivery, so the
 * server never accepts a name the stream and the inbox then filter out. The
 * pull request's author is refused too, as the ranked list never offers them.
 * An ask naming fewer people than it waits for could never resolve.
 */
export interface RecipientsInput {
  directory: readonly Reviewer[]
  requestedById: string
  /** As the requester sent them. A name given twice counts once. */
  recipientIds: readonly string[]
  neededCommitments: number
  /** Reviewer ids of the pull request's author, as far as the server knows them. */
  authorIds: readonly string[]
}

export type RecipientRefusal =
  | { reason: 'too_few'; named: number }
  | { reason: 'unknown'; reviewerId: string }
  | { reason: 'requester' | 'paused' | 'author'; reviewer: Reviewer }

export type RecipientsResolution =
  | { ok: true; reviewers: Reviewer[] }
  | { ok: false; refusal: RecipientRefusal }

export function resolveAttentionRecipients(input: RecipientsInput): RecipientsResolution {
  const wanted = [...new Set(input.recipientIds)]
  if (wanted.length > 0 && wanted.length < input.neededCommitments) {
    return { ok: false, refusal: { reason: 'too_few', named: wanted.length } }
  }
  const directory = new Map(input.directory.map((reviewer) => [reviewer.id, reviewer]))
  const authors = new Set(input.authorIds)
  const reviewers: Reviewer[] = []
  for (const reviewerId of wanted) {
    const reviewer = directory.get(reviewerId)
    if (reviewer === undefined) return { ok: false, refusal: { reason: 'unknown', reviewerId } }
    const reason =
      unaskableReason(reviewer, input.requestedById) ?? (authors.has(reviewerId) ? 'author' : null)
    if (reason !== null) return { ok: false, refusal: { reason, reviewer } }
    reviewers.push(reviewer)
  }
  return { ok: true, reviewers }
}
