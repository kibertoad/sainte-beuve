import type { ProjectRef } from '@sainte-beuve/contracts'
import type { EpochMs, ProjectActivity } from '@sainte-beuve/kernel'
import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { tallyAuthors, tallyVerdicts } from '../tally.js'
import { GITHUB_API_BASE_URL, githubRequest } from './client.js'

/**
 * Who reviewed and who opened a repository's recent pull requests, in one
 * GraphQL call.
 *
 * GraphQL because REST would take one call for the pull requests and one more
 * per pull request for its reviews, and this is read on every recommendation
 * and every automatic assignment. One page of the most recently updated pull
 * requests, each with its verdicts, costs a couple of points of the GraphQL
 * budget.
 */

/** How many of the most recently updated pull requests one read looks at. GitHub's cap per page. */
const HISTORY_PULL_REQUESTS = 100

/** How many verdicts one pull request contributes. More reviewers than this on one change is rare. */
const HISTORY_REVIEWS_PER_PULL_REQUEST = 50

const PAST_ACTIVITY_QUERY = `query PastActivity($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: ${HISTORY_PULL_REQUESTS}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        createdAt
        updatedAt
        author { __typename login }
        reviews(first: ${HISTORY_REVIEWS_PER_PULL_REQUEST}, states: [APPROVED, CHANGES_REQUESTED]) {
          nodes { submittedAt author { login } }
        }
      }
    }
  }
}`

interface PastPullRequest {
  createdAt: string
  updatedAt: string
  author: { __typename: string; login: string } | null
  reviews: { nodes: { submittedAt: string | null; author: { login: string } | null }[] }
}

interface PastActivityAnswer {
  data?: { repository: { pullRequests: { nodes: PastPullRequest[] } } | null } | null
  errors?: { message: string }[]
}

export interface GitHubHistoryRequest {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

export async function pastGitHubActivity(
  project: ProjectRef,
  since: EpochMs,
  request: GitHubHistoryRequest,
): Promise<ProjectActivity> {
  const answer = await githubGraphql<PastActivityAnswer>(
    { query: PAST_ACTIVITY_QUERY, variables: { owner: project.owner, name: project.repo } },
    request,
    'review history',
  )
  const pulls = answer.data?.repository?.pullRequests.nodes ?? []
  return { reviewers: reviewersSince(pulls, since), authors: authorsSince(pulls, since) }
}

function reviewersSince(pulls: readonly PastPullRequest[], since: EpochMs) {
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

function authorsSince(pulls: readonly PastPullRequest[], since: EpochMs) {
  return tallyAuthors(
    pulls
      .filter((pull) => Date.parse(pull.createdAt) >= since)
      .flatMap((pull) =>
        pull.author === null || pull.author.__typename === 'Bot' ? [] : [pull.author.login],
      ),
  )
}

/**
 * One GraphQL request. It refuses with a 200 and an `errors` list, so the
 * status alone says nothing; `what` names the read in the error.
 */
export async function githubGraphql<T extends { errors?: { message: string }[] }>(
  body: { query: string; variables: Record<string, unknown> },
  request: GitHubHistoryRequest,
  what: string,
): Promise<T> {
  const answer = await githubRequest<T>({
    method: 'POST',
    path: '/graphql',
    body,
    token: request.token,
    baseUrl: graphqlBaseOf(request.baseUrl),
    fetchImpl: request.fetchImpl,
  })
  const refusal = answer.errors?.[0]
  if (refusal !== undefined) {
    throw new UpstreamFailedError(`GitHub refused the ${what} read: ${refusal.message}`)
  }
  return answer
}

/**
 * GitHub serves GraphQL beside REST, not under it: `api.github.com/graphql`, and
 * `/api/graphql` on an Enterprise Server whose REST root is `/api/v3`.
 */
export function graphqlBaseOf(baseUrl: string | undefined): string {
  const base = (baseUrl || GITHUB_API_BASE_URL).replace(/\/+$/, '')
  return base.replace(/\/api\/v3$/, '/api')
}
