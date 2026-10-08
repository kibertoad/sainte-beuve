import type {
  MyPullRequest,
  OpenPullRequest,
  Org,
  Project,
  PullRequestStatus,
  Team,
  Viewer,
} from '@sainte-beuve/contracts'
import {
  decideDirectMerge,
  type ResolvedMergeComments,
  resolveMergeComments,
} from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { type RequestPrincipal, roleOf } from '../auth/principal.js'
import { OrgService } from '../orgs/OrgService.js'

/** What decides a merge besides the pull request: the org, the viewer's team, and their role. */
export interface MergeContext {
  org: Org
  team: Team | null
  admin: boolean
}

export async function mergeContextOf(
  container: AppContainer,
  principal: RequestPrincipal,
  viewer: Viewer,
): Promise<MergeContext> {
  const teamName = viewer.reviewer.team
  const [org, team, role] = await Promise.all([
    new OrgService(container).current(),
    teamName === null ? null : container.repositories.teams.getByName(teamName),
    roleOf(container, principal),
  ])
  return { org, team, admin: role === 'admin' }
}

export function mergeCommentsFor(project: Project, context: MergeContext): ResolvedMergeComments {
  return resolveMergeComments({
    project: project.mergeComments,
    team: context.team?.mergeComments ?? null,
    org: context.org.mergeComments,
  })
}

/** A closed or merged pull request is not mergeable, whatever its host last computed. */
export function directMergeFor(
  project: Project,
  status: PullRequestStatus | null,
  context: MergeContext,
): MyPullRequest['merge']['direct'] {
  return decideDirectMerge({
    mergeability: status?.state === 'open' ? status.mergeability : null,
    restrictDirectMerge: project.restrictDirectMerge,
    commentsInForce: mergeCommentsFor(project, context).comments.length,
    admin: context.admin,
  })
}

export function toMyPullRequest(
  read: { pullRequest: OpenPullRequest; project: Project },
  status: { status: PullRequestStatus | null; error: string | null },
  context: MergeContext,
): MyPullRequest {
  const { comments, from } = mergeCommentsFor(read.project, context)
  return {
    ...read.pullRequest,
    projectId: read.project.id,
    status: status.status,
    statusError: status.error,
    merge: {
      direct: directMergeFor(read.project, status.status, context),
      comments,
      commentsFrom: from,
    },
  }
}
