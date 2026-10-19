import type {
  AiReviewCuration,
  AiReviewFinding,
  AiReviewRun,
  AiReviewSeverity,
  RiskPolicy,
} from '@sainte-beuve/contracts'
import { AI_REVIEW_SEVERITY_PENALTY } from '@sainte-beuve/contracts'

// ---------------------------------------------------------------------------
// Whether an AI review vouches for a pull request.
//
// cat-factory's own reviewer gate passes a change when nothing blocking is open
// AND its rating is at or above a threshold (0.8 unless a pipeline sets one).
// Its pull-request review reports findings with severities and no rating, so the
// rating here is read off those findings: a review that found nothing rates 1,
// and each finding still standing takes off what its severity costs. The gate
// is then cat-factory's: nothing at the blocking severity, and the rating at or
// above the policy's minimum.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<AiReviewSeverity, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
  nit: 0,
}

/** A finding its challenge retracted is no longer a finding. */
function standing(curation: AiReviewCuration | null): AiReviewFinding[] {
  return (curation?.findings ?? []).filter((finding) => finding.challenge?.status !== 'retracted')
}

/** The findings that hold a pull request for a person under this threshold. */
export function blockingFindings(
  curation: AiReviewCuration | null,
  threshold: AiReviewSeverity,
): AiReviewFinding[] {
  return standing(curation).filter(
    (finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold],
  )
}

/** The review's rating from 0 to 1, higher is better, to two places. */
export function aiReviewRating(curation: AiReviewCuration | null): number {
  const cost = standing(curation).reduce(
    (sum, finding) => sum + AI_REVIEW_SEVERITY_PENALTY[finding.severity],
    0,
  )
  return Math.round(Math.max(0, 1 - cost) * 100) / 100
}

/** What a settled AI review means for approval. */
export type AiReviewJudgement =
  | { outcome: 'clean'; rating: number }
  | { outcome: 'blocked'; rating: number | null; reason: string }

export type AiReviewGate = Pick<RiskPolicy, 'blockingSeverity' | 'minAiReviewRating'>

function plural(count: number): string {
  return count === 1 ? '1 finding' : `${count} findings`
}

/**
 * A run that has settled on its findings, judged by the policy's gate. Null
 * while it is still working. A run that failed or was cancelled blocks, since
 * nobody vouched for the code. A completed run is judged by its findings too: a
 * person may have curated and posted them before this looked.
 */
export function judgeAiReview(
  run: Pick<AiReviewRun, 'status' | 'curation'>,
  gate: AiReviewGate,
): AiReviewJudgement | null {
  if (run.status === 'failed' || run.status === 'cancelled') {
    return { outcome: 'blocked', rating: null, reason: 'the AI review did not finish' }
  }
  const settled =
    run.status === 'completed' ||
    (run.status === 'awaiting_selection' && run.curation?.status === 'awaiting_selection')
  if (!settled) return null
  const rating = aiReviewRating(run.curation)
  const blocking = blockingFindings(run.curation, gate.blockingSeverity).length
  if (blocking > 0) {
    const reason = `the AI review found ${plural(blocking)} at ${gate.blockingSeverity} or worse`
    return { outcome: 'blocked', rating, reason }
  }
  if (rating < gate.minAiReviewRating) {
    const reason = `the AI review rated it ${rating}, below the ${gate.minAiReviewRating} the policy asks for`
    return { outcome: 'blocked', rating, reason }
  }
  return { outcome: 'clean', rating }
}
