import type { ProjectRef } from '@sainte-beuve/contracts'
import type { OpenPullRequestReviews } from '@sainte-beuve/kernel'
import { distinctLogins } from '../tally.js'
import { type GitLabHistoryRequest, gitlabGraphql, HISTORY_MERGE_REQUESTS } from './history.js'

/**
 * Who has approved each of a project's open merge requests, in one GraphQL
 * call. GitLab records nothing short of an approval as a review.
 */

const OPEN_REVIEWS_QUERY = `query OpenReviews($fullPath: ID!) {
  project(fullPath: $fullPath) {
    mergeRequests(state: opened, sort: UPDATED_DESC, first: ${HISTORY_MERGE_REQUESTS}) {
      nodes {
        iid
        author { username }
        approvedBy { nodes { username } }
      }
    }
  }
}`

interface OpenMergeRequestNode {
  iid: string
  author: { username: string } | null
  approvedBy: { nodes: { username: string }[] } | null
}

interface OpenReviewsAnswer {
  data?: { project: { mergeRequests: { nodes: OpenMergeRequestNode[] } } | null } | null
  errors?: { message: string }[]
}

export async function gitlabOpenPullRequestReviews(
  project: ProjectRef,
  request: GitLabHistoryRequest,
): Promise<OpenPullRequestReviews[]> {
  const answer = await gitlabGraphql<OpenReviewsAnswer>(
    { query: OPEN_REVIEWS_QUERY, variables: { fullPath: `${project.owner}/${project.repo}` } },
    request,
    'open review',
  )
  return (answer.data?.project?.mergeRequests.nodes ?? []).map((merge) => ({
    number: Number(merge.iid),
    reviewerLogins: distinctLogins(
      (merge.approvedBy?.nodes ?? []).map((user) => user.username),
      merge.author?.username ?? null,
    ),
  }))
}
