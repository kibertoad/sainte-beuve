import type { ProjectRef } from '@sainte-beuve/contracts'
import type { EpochMs, ReviewerTally } from '@sainte-beuve/kernel'
import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { tallyVerdicts } from '../tally.js'
import { GITHUB_API_BASE_URL, githubRequest } from './client.js'

/**
 * Who reviewed a repository's recent pull requests, in one GraphQL call.
 *
 * GraphQL because REST would take one call for the pull requests and one more
 * per pull request for its reviews, and this is read on every recommendation
 * and every automatic assignment. One page of the most recently updated pull
 * requests, each with its verdicts, costs a couple of points of the GraphQL
 * budget.
 */

/** How many of the most recently updated pull requests one read looks at. GitHub's cap per page. */
export const HISTORY_PULL_REQUESTS = 100

/** How many verdicts one pull request contributes. More reviewers than this on one change is rare. */
const HISTORY_REVIEWS_PER_PULL_REQUEST = 50

const PAST_REVIEWERS_QUERY = `query PastReviewers($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: ${HISTORY_PULL_REQUESTS}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        updatedAt
        reviews(first: ${HISTORY_REVIEWS_PER_PULL_REQUEST}, states: [APPROVED, CHANGES_REQUESTED]) {
          nodes { submittedAt author { login } }
        }
      }
    }
  }
}`

interface PastReviewersAnswer {
  data?: {
    repository: {
      pullRequests: {
        nodes: {
          updatedAt: string
          reviews: { nodes: { submittedAt: string | null; author: { login: string } | null }[] }
        }[]
      }
    } | null
  } | null
  errors?: { message: string }[]
}

export interface GitHubHistoryRequest {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

export async function pastGitHubReviewers(
  project: ProjectRef,
  since: EpochMs,
  request: GitHubHistoryRequest,
): Promise<ReviewerTally[]> {
  const answer = await githubRequest<PastReviewersAnswer>({
    method: 'POST',
    path: '/graphql',
    body: { query: PAST_REVIEWERS_QUERY, variables: { owner: project.owner, name: project.repo } },
    token: request.token,
    baseUrl: graphqlBaseOf(request.baseUrl),
    fetchImpl: request.fetchImpl,
  })
  // GraphQL refuses with a 200 and an `errors` list, so the status alone says nothing.
  const refusal = answer.errors?.[0]
  if (refusal !== undefined) {
    throw new UpstreamFailedError(`GitHub refused the review history read: ${refusal.message}`)
  }
  const pulls = answer.data?.repository?.pullRequests.nodes ?? []
  return tallyVerdicts(
    pulls
      .filter((pull) => Date.parse(pull.updatedAt) >= since)
      .map((pull) =>
        pull.reviews.nodes
          .filter(
            (review) => review.submittedAt !== null && Date.parse(review.submittedAt) >= since,
          )
          .flatMap((review) => (review.author === null ? [] : [review.author.login])),
      ),
  )
}

/**
 * GitHub serves GraphQL beside REST, not under it: `api.github.com/graphql`, and
 * `/api/graphql` on an Enterprise Server whose REST root is `/api/v3`.
 */
export function graphqlBaseOf(baseUrl: string | undefined): string {
  const base = (baseUrl || GITHUB_API_BASE_URL).replace(/\/+$/, '')
  return base.replace(/\/api\/v3$/, '/api')
}
