import type {
  RecommendReviewers,
  Reviewer,
  ReviewerRecommendations,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import {
  type MatchTarget,
  type ScoredCandidate,
  distinctAsSpelled,
  excludedFromReview,
  pastReviewCounts,
  rankCandidates,
  reviewersWithHandles,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { readReviewHistory } from './pastReviews.js'
import { wantedFor } from './wanted.js'

/**
 * Who an author asking for attention should pick for a pull request, best first.
 *
 * The pull request's board row, when it has one, supplies what the caller did
 * not: the skills it already wants, its author and whoever is already on it.
 * The people the host lists for it are left out as well, and the caller is
 * never recommended, because an ask never reaches the person who raised it.
 */
export class RecommendationService {
  constructor(private readonly container: AppContainer) {}

  async recommend(viewer: Reviewer, input: RecommendReviewers): Promise<ReviewerRecommendations> {
    const { target, ranked, shortfallReason } = await this.rank(viewer, input)
    return {
      wanted: {
        skills: distinctAsSpelled(target.skills),
        domains: distinctAsSpelled(target.domains),
      },
      recommendations: ranked.map(toRecommendation),
      shortfallReason,
    }
  }

  /**
   * The ranking `recommend` answers with, each candidate with their directory
   * entry. Against `wanted` when it is given, as an ask stores what it was
   * matched on; otherwise against what the caller picked or the pull request wants.
   */
  async rank(viewer: Reviewer, input: RecommendReviewers, wanted: MatchTarget | null = null) {
    const { pullRequest } = input
    const { repositories } = this.container
    const [candidates, review, project, history] = await Promise.all([
      repositories.reviewers.list(),
      repositories.reviews.getByPullRequest(pullRequest),
      wanted === null ? repositories.projects.getByRef(pullRequest) : null,
      readReviewHistory(this.container, pullRequest),
    ])
    const target = wanted ?? wantedFor(input.requiredSkills, { project, review })
    const { ranked, shortfallReason } = rankCandidates({
      ...target,
      candidates,
      audience: { requestedById: viewer.id, team: viewer.team, sameTeamOnly: input.sameTeamOnly },
      excludeReviewerIds: excluded(input, review, candidates),
      pastReviews: pastReviewCounts(history, candidates, pullRequest.provider),
      limit: input.limit,
    })
    return { target, ranked, shortfallReason }
  }
}

/** Whoever the board row or the host already has on the pull request, and its author. */
function excluded(
  input: RecommendReviewers,
  review: ReviewRequest | null,
  candidates: readonly Reviewer[],
): string[] {
  const onBoard = review === null ? [] : excludedFromReview(review, candidates)
  if (input.people === null) return onBoard
  const { authorLogin, requestedReviewerLogins } = input.people
  const onHost = reviewersWithHandles(candidates, input.pullRequest.provider, [
    authorLogin,
    ...requestedReviewerLogins,
  ])
  return [...onBoard, ...onHost]
}

function toRecommendation(candidate: ScoredCandidate) {
  return {
    reviewerId: candidate.reviewer.id,
    displayName: candidate.reviewer.displayName,
    team: candidate.reviewer.team,
    fit: candidate.affinity,
    reasons: {
      matchedSkills: candidate.matchedSkills,
      matchedDomains: candidate.matchedDomains,
      outstandingReviews: candidate.reviewer.outstandingReviews,
      pastReviews: candidate.pastReviews,
    },
  }
}
