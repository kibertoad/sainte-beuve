import type { OpenPullRequest, ProjectRef, PullRequestStatus } from '@sainte-beuve/contracts'
import type { VcsGateway } from '@sainte-beuve/kernel'

/**
 * A source-control gateway acting as one named person, over a fixed list of
 * open pull requests. What the workspace suite needs and the board suite does
 * not, so it is separate from `recordingVcs`.
 */
export function viewerVcs(
  username: string,
  pullRequests: OpenPullRequest[] = [],
  statuses: Record<number, Partial<PullRequestStatus>> = {},
): VcsGateway & {
  listed: ProjectRef[]
  merged: { number: number; sha: string }[]
  comments: { number: number; body: string }[]
} {
  const listed: ProjectRef[] = []
  const merged: { number: number; sha: string }[] = []
  const comments: { number: number; body: string }[] = []
  return {
    listed,
    merged,
    comments,
    requestReviewers: async () => {},
    removeRequestedReviewers: async () => {},
    comment: async (pr, body) => {
      comments.push({ number: pr.number, body })
    },
    pullRequestStatus: async (pr) => {
      const listedPr = pullRequests.find((open) => open.pullRequest.number === pr.number)
      return {
        state: 'open',
        url:
          listedPr?.pullRequest.url ??
          `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`,
        authorLogin: listedPr?.authorLogin ?? username,
        draft: listedPr?.draft ?? false,
        approval: 'pending',
        mergeability: 'mergeable',
        headSha: `sha-${pr.number}`,
        ...statuses[pr.number],
      }
    },
    merge: async (pr, sha) => {
      merged.push({ number: pr.number, sha })
    },
    listOpenPullRequests: async (project) => {
      listed.push(project)
      // The HOST is part of the match, as it is in a real adapter: a gateway
      // for one host cannot answer with the other's pull requests.
      return pullRequests.filter(
        (pr) =>
          pr.pullRequest.provider === project.provider &&
          pr.pullRequest.owner === project.owner &&
          pr.pullRequest.repo === project.repo,
      )
    },
    listAuthoredOpenPullRequests: async (login) =>
      pullRequests.filter((pr) => pr.authorLogin === login),
    identify: async () => ({
      subject: `subject-${username}`,
      username,
      displayName: null,
      avatarUrl: null,
    }),
  }
}

/**
 * A gateway authenticated as the deployment's own App: it reaches repositories
 * and it identifies NOBODY, which is exactly what an installation token is.
 */
export function appVcs(pullRequests: OpenPullRequest[] = []): VcsGateway {
  return {
    ...viewerVcs('installation', pullRequests),
    listAuthoredOpenPullRequests: async () => [],
    identify: async () => null,
  }
}
