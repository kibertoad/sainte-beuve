import type {
  AskSuggestedReviewers,
  AttentionRequest,
  PullRequestRef,
  Reviewer,
  ReviewerSuggestions,
  ReviewerSuggestionsQuery,
} from '@sainte-beuve/contracts'
import {
  MAX_NEEDED_COMMITMENTS,
  MAX_RECOMMENDATIONS,
  SUGGESTED_REVIEWER_COUNT,
} from '@sainte-beuve/contracts'
import { ConflictError, pullRequestKey } from '@sainte-beuve/kernel'
import {
  distinctAsSpelled,
  isBotReviewer,
  planReviewerSuggestions,
  reviewersWithHandles,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { AttentionService } from '../attention/AttentionService.js'
import { RecommendationService, toRecommendation } from '../reviewers/RecommendationService.js'
import { readAuthored } from './authored.js'

/** How many ranked matches the dialog lists. */
const LISTED = 10

const NOT_YOURS =
  'My PRs only suggests reviewers for pull requests you opened. Ask the author to pick them.'

const ALL_ON_IT = 'Everybody you picked has already committed to reviewing this pull request.'

/**
 * Picking reviewers for your own pull request from My PRs. The ranking is the
 * one the attention dialog shows, and asking is a named attention ask, so the
 * people picked hear of it as any named ask reaches them and commit through it.
 */
export class ReviewerSuggestionService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async suggest(input: ReviewerSuggestionsQuery): Promise<ReviewerSuggestions> {
    const { pullRequest } = input
    const { viewer, status } = await readAuthored(
      this.container,
      this.principal,
      pullRequest,
      NOT_YOURS,
    )
    const people = {
      authorLogin: status.authorLogin,
      requestedReviewerLogins: input.requestedReviewerLogins,
    }
    const { repositories } = this.container
    const [ranking, directory, committedIds, asks] = await Promise.all([
      new RecommendationService(this.container).rank(viewer.reviewer, {
        pullRequest,
        requiredSkills: [],
        sameTeamOnly: false,
        people,
        limit: MAX_RECOMMENDATIONS,
      }),
      repositories.reviewers.list(),
      this.committedIds(pullRequest),
      this.openAsks(pullRequest),
    ])
    const provider = pullRequest.provider
    const plan = planReviewerSuggestions({
      ranked: ranking.ranked,
      directory,
      provider,
      requestedById: viewer.reviewer.id,
      authorIds: reviewersWithHandles(directory, provider, [status.authorLogin]),
      committedIds: [...committedIds],
      requestedIds: reviewersWithHandles(directory, provider, input.requestedReviewerLogins),
      asks,
      limit: LISTED,
      wanted: SUGGESTED_REVIEWER_COUNT,
    })
    const emptied = plan.candidates.length === 0 && ranking.ranked.length > 0
    return {
      wanted: {
        skills: distinctAsSpelled(ranking.target.skills),
        domains: distinctAsSpelled(ranking.target.domains),
      },
      recommendations: plan.candidates.map(toRecommendation),
      shortfallReason: emptied ? 'all_excluded' : ranking.shortfallReason,
      preselectedIds: plan.preselectedIds,
      others: plan.others.map(person),
      involved: plan.involved.map(({ reviewer, state }) => ({ ...person(reviewer), state })),
    }
  }

  /**
   * Ask the people picked to commit, on the caller's open ask for the pull
   * request when there is one and on a new one otherwise. Whoever already
   * committed, or was already asked on that ask, is passed over.
   */
  async ask(input: AskSuggestedReviewers): Promise<AttentionRequest> {
    const { viewer, status } = await readAuthored(
      this.container,
      this.principal,
      input.pullRequest,
      NOT_YOURS,
    )
    const [directory, committedIds, asks] = await Promise.all([
      this.container.repositories.reviewers.list(),
      this.committedIds(input.pullRequest),
      this.openAsks(input.pullRequest),
    ])
    const bots = new Set(
      directory
        .filter((reviewer) => isBotReviewer(reviewer, input.pullRequest.provider))
        .map((reviewer) => reviewer.id),
    )
    const fresh = [...new Set(input.reviewerIds)].filter(
      (reviewerId) => !committedIds.has(reviewerId) && !bots.has(reviewerId),
    )
    const own = ownNamedAsk(asks, viewer.reviewer)
    if (fresh.length === 0) {
      if (own !== null) return own
      throw new ConflictError(ALL_ON_IT)
    }
    const attention = new AttentionService(this.container)
    if (own !== null) return attention.askMore(viewer.reviewer, own.id, fresh)
    return attention.raise(viewer.reviewer, {
      pullRequest: { ...input.pullRequest, url: status.url },
      title: input.title,
      recipientIds: fresh,
      requiredSkills: [],
      sameTeamOnly: false,
      // Each person picked was asked by name, so the ask stays open until each has answered.
      neededCommitments: Math.min(fresh.length, MAX_NEEDED_COMMITMENTS),
      note: input.note,
      keepAsking: false,
      people: { authorLogin: status.authorLogin, requestedReviewerLogins: [] },
    })
  }

  private async committedIds(pullRequest: PullRequestRef): Promise<Set<string>> {
    const commitments = await this.container.repositories.commitments.listByPullRequests([
      pullRequest,
    ])
    return new Set(commitments.map((commitment) => commitment.reviewerId))
  }

  private async openAsks(pullRequest: PullRequestRef): Promise<AttentionRequest[]> {
    const key = pullRequestKey(pullRequest)
    const open = await this.container.repositories.attention.list({ status: ['open'] })
    return open.filter((request) => pullRequestKey(request.pullRequest) === key)
  }
}

/** The caller's latest open ask on the pull request that names people, which more can be added to. */
function ownNamedAsk(
  asks: readonly AttentionRequest[],
  requester: Reviewer,
): AttentionRequest | null {
  const own = asks.filter(
    (request) => request.requestedById === requester.id && request.recipients.length > 0,
  )
  return own.toSorted((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

function person(reviewer: Reviewer) {
  return { reviewerId: reviewer.id, displayName: reviewer.displayName, team: reviewer.team }
}
