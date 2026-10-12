import type {
  RecommendReviewers,
  Reviewer,
  ReviewerRecommendations,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import {
  type ScoredCandidate,
  distinctAsSpelled,
  excludedFromReview,
  matchTargetFor,
  rankCandidates,
  reviewersWithHandles,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

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
    const { repositories } = this.container
    const { pullRequest } = input
    const [candidates, project, boardRow] = await Promise.all([
      repositories.reviewers.list(),
      repositories.projects.getByRef(pullRequest),
      repositories.reviews.getByPullRequest(pullRequest),
    ])
    // The board looks a row up by owner, repo and number alone, so a row from
    // the other host under the same names is not this pull request.
    const review = boardRow?.pullRequest.provider === pullRequest.provider ? boardRow : null
    const target = matchTargetFor(
      {
        requiredSkills:
          input.requiredSkills.length > 0 ? input.requiredSkills : (review?.requiredSkills ?? []),
      },
      project,
    )
    const { ranked, shortfallReason } = rankCandidates({
      ...target,
      candidates,
      audience: { requestedById: viewer.id, team: viewer.team, sameTeamOnly: input.sameTeamOnly },
      excludeReviewerIds: excluded(input, review, candidates),
      limit: input.limit,
    })
    return {
      wanted: {
        skills: distinctAsSpelled(target.skills),
        domains: distinctAsSpelled(target.domains),
      },
      recommendations: ranked.map(toRecommendation),
      shortfallReason,
    }
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
    },
  }
}
