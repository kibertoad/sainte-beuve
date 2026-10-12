import type { AiReviewCuration } from '@sainte-beuve/contracts'

/**
 * WHETHER ONE FINDING MAY BE CHALLENGED, decided over the parked review.
 *
 * A challenge dispatches cat-factory's investigator, which is billed model work
 * like the review itself, and the button sits beside every finding. So:
 *
 *  1. ONLY A PARKED REVIEW. A challenge is curation, and a review that is
 *     reviewing, fixing, posting or done has nothing to curate.
 *  2. ONE AT A TIME. A review that is `challenging` already has an investigator
 *     out, and cat-factory re-parks it with that verdict before it takes another.
 *  3. ONE PER FINDING. A verdict is the second opinion; asking for a third on the
 *     same finding is the same money for the same question. A challenge that
 *     FAILED bought no verdict, so that finding may be asked about again, and a
 *     retracted one is out of the review for good.
 *  4. A FEW PER REVIEW. Past {@link AI_REVIEW_CHALLENGE_LIMIT} verdicts on one
 *     review, the rest of the findings are judged by a person.
 *
 * Counted from the curation rather than a counter of its own, because rule 3
 * makes the verdicts on the findings the whole record: each finding carries at
 * most one, and a failure that freed its finding is not counted.
 */

/** How many challenges one review may have answered. */
export const AI_REVIEW_CHALLENGE_LIMIT = 5

export type AiChallengeAdmission =
  | { admitted: true }
  | { admitted: false; reason: 'not_parked' | 'challenging' | 'unknown_finding' | 'review_limit' }
  | { admitted: false; reason: 'already_challenged'; verdict: 'upheld' | 'amended' | 'retracted' }

export function decideChallengeAdmission(
  curation: AiReviewCuration | null,
  findingId: string,
): AiChallengeAdmission {
  if (curation?.status === 'challenging') return { admitted: false, reason: 'challenging' }
  if (curation?.status !== 'awaiting_selection') return { admitted: false, reason: 'not_parked' }
  const finding = curation.findings.find((entry) => entry.findingId === findingId)
  if (finding === undefined) return { admitted: false, reason: 'unknown_finding' }
  const verdict = finding.challenge?.status
  if (verdict === 'upheld' || verdict === 'amended' || verdict === 'retracted') {
    return { admitted: false, reason: 'already_challenged', verdict }
  }
  if (answeredChallenges(curation) >= AI_REVIEW_CHALLENGE_LIMIT) {
    return { admitted: false, reason: 'review_limit' }
  }
  return { admitted: true }
}

/** The findings a challenge has delivered a verdict on. */
function answeredChallenges(curation: AiReviewCuration): number {
  return curation.findings.filter((finding) => {
    const status = finding.challenge?.status
    return status === 'upheld' || status === 'amended' || status === 'retracted'
  }).length
}

/** The findings a challenge retracted, which no resolution may act on. */
export function retractedFindingIds(curation: AiReviewCuration | null): Set<string> {
  return new Set(
    (curation?.findings ?? [])
      .filter((finding) => finding.challenge?.status === 'retracted')
      .map((finding) => finding.findingId),
  )
}
