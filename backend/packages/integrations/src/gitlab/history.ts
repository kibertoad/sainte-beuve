import type { ProjectRef } from '@sainte-beuve/contracts'
import type { EpochMs, ReviewerTally } from '@sainte-beuve/kernel'
import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { tallyVerdicts } from '../tally.js'
import { GITLAB_GRAPHQL_ROOT, gitlabRequest } from './client.js'

/**
 * Who approved a project's recent merge requests, in one GraphQL call.
 *
 * GraphQL because the REST list carries no approvals, and reading them is one
 * more call per merge request. GitLab records nothing short of an approval as a
 * finished review, so approvals are the verdicts counted.
 */

/** How many of the most recently updated merge requests one read looks at. */
export const HISTORY_MERGE_REQUESTS = 100

const PAST_APPROVERS_QUERY = `query PastApprovers($fullPath: ID!, $updatedAfter: Time!) {
  project(fullPath: $fullPath) {
    mergeRequests(updatedAfter: $updatedAfter, sort: UPDATED_DESC, first: ${HISTORY_MERGE_REQUESTS}) {
      nodes { approvedBy { nodes { username } } }
    }
  }
}`

interface PastApproversAnswer {
  data?: {
    project: {
      mergeRequests: { nodes: { approvedBy: { nodes: { username: string }[] } | null }[] }
    } | null
  } | null
  errors?: { message: string }[]
}

export interface GitLabHistoryRequest {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

export async function pastGitLabReviewers(
  project: ProjectRef,
  since: EpochMs,
  request: GitLabHistoryRequest,
): Promise<ReviewerTally[]> {
  const answer = await gitlabRequest<PastApproversAnswer>({
    method: 'POST',
    root: GITLAB_GRAPHQL_ROOT,
    path: '/graphql',
    body: {
      query: PAST_APPROVERS_QUERY,
      variables: {
        fullPath: `${project.owner}/${project.repo}`,
        updatedAfter: new Date(since).toISOString(),
      },
    },
    token: request.token,
    baseUrl: request.baseUrl,
    fetchImpl: request.fetchImpl,
  })
  // GraphQL refuses with a 200 and an `errors` list, so the status alone says nothing.
  const refusal = answer.errors?.[0]
  if (refusal !== undefined) {
    throw new UpstreamFailedError(`GitLab refused the review history read: ${refusal.message}`)
  }
  const merges = answer.data?.project?.mergeRequests.nodes ?? []
  return tallyVerdicts(
    merges.map((merge) => (merge.approvedBy?.nodes ?? []).map((user) => user.username)),
  )
}
