import type { ProjectRef } from '@sainte-beuve/contracts'
import type { OpenPullRequestReviews } from '@sainte-beuve/kernel'
import { distinctLogins } from '../tally.js'
import { type GitHubHistoryRequest, githubGraphql, HISTORY_PULL_REQUESTS } from './history.js'

/**
 * Who has reviewed each of a repository's open pull requests, in one GraphQL
 * call. Any submitted review counts. GitHub shows a pending review only to the
 * account writing it, so no state filter is needed.
 */

const REVIEWS_PER_PULL_REQUEST = 50

const OPEN_REVIEWS_QUERY = `query OpenReviews($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${HISTORY_PULL_REQUESTS}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        author { login }
        reviews(first: ${REVIEWS_PER_PULL_REQUEST}) { nodes { author { __typename login } } }
      }
    }
  }
}`

interface OpenPullRequestNode {
  number: number
  author: { login: string } | null
  reviews: { nodes: { author: { __typename: string; login: string } | null }[] }
}

interface OpenReviewsAnswer {
  data?: { repository: { pullRequests: { nodes: OpenPullRequestNode[] } } | null } | null
  errors?: { message: string }[]
}

export async function githubOpenPullRequestReviews(
  project: ProjectRef,
  request: GitHubHistoryRequest,
): Promise<OpenPullRequestReviews[]> {
  const answer = await githubGraphql<OpenReviewsAnswer>(
    { query: OPEN_REVIEWS_QUERY, variables: { owner: project.owner, name: project.repo } },
    request,
    'open review',
  )
  return (answer.data?.repository?.pullRequests.nodes ?? []).map((pull) => ({
    number: pull.number,
    reviewerLogins: distinctLogins(
      pull.reviews.nodes.flatMap((review) =>
        review.author?.__typename === 'User' ? [review.author.login] : [],
      ),
      pull.author?.login ?? null,
    ),
  }))
}
