import type { ProjectRef } from '@sainte-beuve/contracts'
import type { EpochMs, ProjectActivity } from '@sainte-beuve/kernel'
import { UpstreamFailedError } from '@sainte-beuve/kernel'
import { tallyAuthors, tallyVerdicts } from '../tally.js'
import { GITLAB_GRAPHQL_ROOT, gitlabRequest } from './client.js'

/**
 * Who approved and who opened a project's recent merge requests, in one
 * GraphQL call.
 *
 * GraphQL because the REST list carries no approvals, and reading them is one
 * more call per merge request. GitLab records nothing short of an approval as a
 * finished review, so approvals are the verdicts counted.
 */

/** How many of the most recently updated merge requests one read looks at. */
export const HISTORY_MERGE_REQUESTS = 100

const PAST_ACTIVITY_QUERY = `query PastActivity($fullPath: ID!, $updatedAfter: Time!) {
  project(fullPath: $fullPath) {
    mergeRequests(updatedAfter: $updatedAfter, sort: UPDATED_DESC, first: ${HISTORY_MERGE_REQUESTS}) {
      nodes {
        createdAt
        author { username bot }
        approvedBy { nodes { username } }
      }
    }
  }
}`

interface PastMergeRequest {
  createdAt: string
  author: { username: string; bot: boolean } | null
  approvedBy: { nodes: { username: string }[] } | null
}

interface PastActivityAnswer {
  data?: { project: { mergeRequests: { nodes: PastMergeRequest[] } } | null } | null
  errors?: { message: string }[]
}

export interface GitLabHistoryRequest {
  token: string
  baseUrl?: string
  fetchImpl?: typeof globalThis.fetch
}

export async function pastGitLabActivity(
  project: ProjectRef,
  since: EpochMs,
  request: GitLabHistoryRequest,
): Promise<ProjectActivity> {
  const answer = await gitlabGraphql<PastActivityAnswer>(
    {
      query: PAST_ACTIVITY_QUERY,
      variables: {
        fullPath: `${project.owner}/${project.repo}`,
        updatedAfter: new Date(since).toISOString(),
      },
    },
    request,
    'review history',
  )
  const merges = answer.data?.project?.mergeRequests.nodes ?? []
  return {
    reviewers: tallyVerdicts(
      merges.map((merge) => (merge.approvedBy?.nodes ?? []).map((user) => user.username)),
    ),
    authors: tallyAuthors(
      merges
        .filter((merge) => Date.parse(merge.createdAt) >= since)
        .flatMap((merge) =>
          merge.author === null || merge.author.bot ? [] : [merge.author.username],
        ),
    ),
  }
}

/**
 * One GraphQL request. It refuses with a 200 and an `errors` list, so the
 * status alone says nothing; `what` names the read in the error.
 */
export async function gitlabGraphql<T extends { errors?: { message: string }[] }>(
  body: { query: string; variables: Record<string, unknown> },
  request: GitLabHistoryRequest,
  what: string,
): Promise<T> {
  const answer = await gitlabRequest<T>({
    method: 'POST',
    root: GITLAB_GRAPHQL_ROOT,
    path: '/graphql',
    body,
    token: request.token,
    baseUrl: request.baseUrl,
    fetchImpl: request.fetchImpl,
  })
  const refusal = answer.errors?.[0]
  if (refusal !== undefined) {
    throw new UpstreamFailedError(`GitLab refused the ${what} read: ${refusal.message}`)
  }
  return answer
}
