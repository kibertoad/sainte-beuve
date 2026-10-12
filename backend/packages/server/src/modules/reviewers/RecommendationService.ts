import type {
  RecommendReviewers,
  Reviewer,
  ReviewerRecommendations,
  ReviewRequest,
} from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import { isSameHandle, matchTargetFor, rankCandidates } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { pastReviewCounts } from './pastReviews.js'

/**
 * Who should review a pull request, best first.
 *
 * The pull request's board row, when it has one, supplies what the caller did
 * not: the skills it already wants, its author and whoever is already on it.
 * The caller is left out too, because the question is who ELSE should look,
 * and the author asking for attention on their own pull request is the usual
 * caller.
 */
export class RecommendationService {
  constructor(private readonly container: AppContainer) {}

  async recommend(viewer: Reviewer, input: RecommendReviewers): Promise<ReviewerRecommendations> {
    const { repositories } = this.container
    const { pullRequest } = input
    const [candidates, project, boardRow, pastReviews] = await Promise.all([
      repositories.reviewers.list(),
      repositories.projects.getByRef(pullRequest),
      repositories.reviews.getByPullRequest(pullRequest),
      pastReviewCounts(this.container, pullRequest),
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
      excludeReviewerIds: [viewer.id, ...excludedBy(review, candidates)],
      pastReviews,
      limit: input.limit,
    })
    return {
      wanted: { skills: [...target.skills], domains: [...target.domains] },
      recommendations: ranked.map((candidate) => ({
        reviewerId: candidate.reviewer.id,
        displayName: candidate.reviewer.displayName,
        team: candidate.reviewer.team,
        score: candidate.weight,
        reasons: {
          matchedSkills: candidate.matchedSkills,
          matchedDomains: candidate.matchedDomains,
          outstandingReviews: candidate.reviewer.outstandingReviews,
          pastReviews: candidate.pastReviews,
        },
      })),
      shortfallReason,
    }
  }
}

/** The people a board row rules out: whoever is on it, and its author by their handle on its host. */
function excludedBy(review: ReviewRequest | null, candidates: readonly Reviewer[]): string[] {
  if (review === null) return []
  const provider = review.pullRequest.provider
  const authors = candidates
    .filter((r) => isSameHandle(handleOf(r.handles, provider), review.authorLogin))
    .map((r) => r.id)
  return [...review.assignedReviewerIds, ...authors]
}
