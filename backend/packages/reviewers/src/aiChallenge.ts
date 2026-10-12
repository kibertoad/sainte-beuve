import type {
  AiReviewChallengeStatus,
  AiReviewCuration,
  AiReviewRun,
} from '@sainte-beuve/contracts'
import { AI_REVIEW_CHALLENGE_LIMIT, challengedFindingIdsOf } from '@sainte-beuve/contracts'

/**
 * WHETHER ONE FINDING MAY BE CHALLENGED, decided over the parked review.
 *
 * A challenge dispatches cat-factory's investigator, which is billed model work
 * like the review itself, and the button sits beside every finding. So:
 *
 *  1. ONLY A PARKED REVIEW. A challenge is curation, and a review that is
 *     reviewing, fixing, posting or done has nothing to curate. The run's status
 *     is asked as well as the curation's, because a settled run keeps the
 *     curation it last reported, which can still read `awaiting_selection`.
 *  2. ONE AT A TIME. A review that is `challenging` already has an investigator
 *     out, and cat-factory re-parks it with that verdict before it takes another.
 *  3. ONE PER FINDING. A verdict is the second opinion; asking for a third on the
 *     same finding is the same money for the same question. A challenge that
 *     FAILED bought no verdict, so that finding may be asked about again, and a
 *     retracted one is out of the review for good.
 *  4. A FEW PER REVIEW. Once {@link AI_REVIEW_CHALLENGE_LIMIT} findings of one
 *     review have been challenged, the rest are judged by a person. Counted over
 *     the findings CHALLENGED rather than the verdicts the curation holds, so
 *     dismissing a challenged finding does not hand its challenge back.
 */
/** The challenge statuses that are an answer, as opposed to one pending or failed. */
type Verdict = 'upheld' | 'amended' | 'retracted'

export type AiChallengeAdmission =
  | { admitted: true }
  | { admitted: false; reason: 'not_parked' | 'challenging' | 'unknown_finding' | 'review_limit' }
  | { admitted: false; reason: 'already_challenged'; verdict: Verdict }

export type ChallengeRun = Pick<AiReviewRun, 'status' | 'curation' | 'challengedFindingIds'>

export function decideChallengeAdmission(
  run: ChallengeRun,
  findingId: string,
): AiChallengeAdmission {
  const { curation } = run
  if (run.status === 'running' && curation?.status === 'challenging') {
    return { admitted: false, reason: 'challenging' }
  }
  if (run.status !== 'awaiting_selection' || curation?.status !== 'awaiting_selection') {
    return { admitted: false, reason: 'not_parked' }
  }
  const finding = curation.findings.find((entry) => entry.findingId === findingId)
  if (finding === undefined) return { admitted: false, reason: 'unknown_finding' }
  const verdict = finding.challenge?.status
  if (isVerdict(verdict)) {
    return { admitted: false, reason: 'already_challenged', verdict }
  }
  const challenged = challengedFindingIdsOf(run)
  if (!challenged.has(findingId) && challenged.size >= AI_REVIEW_CHALLENGE_LIMIT) {
    return { admitted: false, reason: 'review_limit' }
  }
  return { admitted: true }
}

function isVerdict(status: AiReviewChallengeStatus | undefined): status is Verdict {
  return status === 'upheld' || status === 'amended' || status === 'retracted'
}

/** The findings a challenge retracted, which no resolution may act on. */
export function retractedFindingIds(curation: AiReviewCuration | null): Set<string> {
  return new Set(
    (curation?.findings ?? [])
      .filter((finding) => finding.challenge?.status === 'retracted')
      .map((finding) => finding.findingId),
  )
}
