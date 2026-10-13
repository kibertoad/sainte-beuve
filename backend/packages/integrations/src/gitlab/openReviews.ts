import type { ProjectRef } from '@sainte-beuve/contracts'
import type { OpenPullRequestReviews } from '@sainte-beuve/kernel'
import { distinctLogins } from '../tally.js'
import { MAX_PAGES, PAGE_SIZE } from './client.js'
import { type GitLabHistoryRequest, gitlabGraphql } from './history.js'

const OPEN_REVIEWS_QUERY = `query OpenReviews($fullPath: ID!, $after: String) {
  project(fullPath: $fullPath) {
    mergeRequests(state: opened, sort: UPDATED_DESC, first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        iid
        author { username }
        approvedBy { nodes { username bot } }
      }
    }
  }
}`

interface OpenMergeRequestNode {
  iid: string
  author: { username: string } | null
  approvedBy: { nodes: { username: string; bot: boolean }[] } | null
}

interface OpenReviewsAnswer {
  data?: {
    project: {
      mergeRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: OpenMergeRequestNode[]
      }
    } | null
  } | null
  errors?: { message: string }[]
}

/**
 * Who has approved each of a project's open merge requests, a page of a hundred
 * per GraphQL call, down to the same depth `listOpenPullRequests` reads. GitLab
 * records nothing short of an approval as a review.
 */
export async function gitlabOpenPullRequestReviews(
  project: ProjectRef,
  request: GitLabHistoryRequest,
): Promise<OpenPullRequestReviews[]> {
  const merges: OpenMergeRequestNode[] = []
  let after: string | null = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const answer: OpenReviewsAnswer = await gitlabGraphql<OpenReviewsAnswer>(
      {
        query: OPEN_REVIEWS_QUERY,
        variables: { fullPath: `${project.owner}/${project.repo}`, after },
      },
      request,
      'open review',
    )
    const connection = answer.data?.project?.mergeRequests
    if (connection === undefined) break
    merges.push(...connection.nodes)
    if (!connection.pageInfo.hasNextPage || connection.pageInfo.endCursor === null) break
    after = connection.pageInfo.endCursor
  }
  return merges.map(approvalsOf)
}

function approvalsOf(merge: OpenMergeRequestNode): OpenPullRequestReviews {
  return {
    number: Number(merge.iid),
    reviewerLogins: distinctLogins(
      (merge.approvedBy?.nodes ?? []).filter((user) => !user.bot).map((user) => user.username),
      merge.author?.username ?? null,
    ),
  }
}
