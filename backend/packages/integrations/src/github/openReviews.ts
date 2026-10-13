import type { ProjectRef } from '@sainte-beuve/contracts'
import type { OpenPullRequestReviews } from '@sainte-beuve/kernel'
import { distinctLogins } from '../tally.js'
import { MAX_PAGES, PAGE_SIZE } from './client.js'
import { type GitHubHistoryRequest, githubGraphql } from './history.js'

const REVIEWS_PER_PULL_REQUEST = 50

/**
 * Any submitted review counts. PENDING is left out by name: GitHub shows a
 * draft review to the account writing it, and that account is often the viewer.
 */
const OPEN_REVIEWS_QUERY = `query OpenReviews($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${PAGE_SIZE}, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        author { login }
        reviews(first: ${REVIEWS_PER_PULL_REQUEST}, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
          nodes { author { __typename login } }
        }
        reviewRequests(first: ${REVIEWS_PER_PULL_REQUEST}) {
          nodes { requestedReviewer { __typename ... on User { login } } }
        }
      }
    }
  }
}`

interface OpenPullRequestNode {
  number: number
  author: { login: string } | null
  reviews: { nodes: { author: { __typename: string; login: string } | null }[] }
  reviewRequests: {
    nodes: { requestedReviewer: { __typename: string; login?: string } | null }[]
  } | null
}

interface OpenReviewsAnswer {
  data?: {
    repository: {
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: OpenPullRequestNode[]
      }
    } | null
  } | null
  errors?: { message: string }[]
}

/**
 * Who has reviewed each of a repository's open pull requests, a page of a
 * hundred per GraphQL call, down to the same depth `listOpenPullRequests` reads.
 */
export async function githubOpenPullRequestReviews(
  project: ProjectRef,
  request: GitHubHistoryRequest,
): Promise<OpenPullRequestReviews[]> {
  const pulls: OpenPullRequestNode[] = []
  let after: string | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const answer: OpenReviewsAnswer = await githubGraphql<OpenReviewsAnswer>(
      { query: OPEN_REVIEWS_QUERY, variables: { owner: project.owner, name: project.repo, after } },
      request,
      'open review',
    )
    const connection = answer.data?.repository?.pullRequests
    if (connection === undefined) break
    pulls.push(...connection.nodes)
    if (!connection.pageInfo.hasNextPage || connection.pageInfo.endCursor === null) break
    after = connection.pageInfo.endCursor
  }
  return pulls.map(reviewsOf)
}

function reviewsOf(pull: OpenPullRequestNode): OpenPullRequestReviews {
  return {
    number: pull.number,
    reviewerLogins: distinctLogins(
      pull.reviews.nodes.flatMap((review) =>
        review.author?.__typename === 'User' ? [review.author.login] : [],
      ),
      pull.author?.login ?? null,
    ),
    awaitingLogins: distinctLogins(
      (pull.reviewRequests?.nodes ?? []).flatMap(({ requestedReviewer: reviewer }) =>
        reviewer?.__typename === 'User' && reviewer.login !== undefined ? [reviewer.login] : [],
      ),
    ),
  }
}
