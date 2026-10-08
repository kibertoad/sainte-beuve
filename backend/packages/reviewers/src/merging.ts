import type {
  DirectMerge,
  Mergeability,
  MergeComment,
  MergeCommentSource,
  MyPullRequestStatusFilter,
  MyPullRequestsQuery,
  OpenPullRequest,
  Project,
  ProjectRef,
  PullRequestApproval,
} from '@sainte-beuve/contracts'

/** The merge comments configured at each level. Null on a team or project inherits. */
export interface MergeCommentLevels {
  project: MergeComment[] | null
  team: MergeComment[] | null
  org: MergeComment[]
}

export interface ResolvedMergeComments {
  comments: MergeComment[]
  /** The level that decided, or null when none configures any. */
  from: MergeCommentSource | null
}

/** The most specific level that says anything wins: project, then team, then org. */
export function resolveMergeComments(levels: MergeCommentLevels): ResolvedMergeComments {
  if (levels.project !== null) return { comments: levels.project, from: 'project' }
  if (levels.team !== null) return { comments: levels.team, from: 'team' }
  if (levels.org.length > 0) return { comments: levels.org, from: 'org' }
  return { comments: [], from: null }
}

export interface DirectMergeInput {
  /** Null when the host could not be asked. */
  mergeability: Mergeability | null
  restrictDirectMerge: boolean
  commentsInForce: number
  admin: boolean
}

/**
 * Whether a direct merge is on offer. The restriction only applies while the
 * project has merge comments in force: with none, there is no other way to
 * merge from here, and refusing would strand the pull request.
 */
export function decideDirectMerge(input: DirectMergeInput): DirectMerge {
  if (input.mergeability !== 'mergeable') return 'not_mergeable'
  if (input.restrictDirectMerge && input.commentsInForce > 0) {
    return input.admin ? 'override' : 'restricted'
  }
  return 'allowed'
}

/** Whether a pull request belongs under a status filter. A draft is only ever under `draft`. */
export function matchesStatusFilter(
  filter: MyPullRequestStatusFilter,
  pr: { draft: boolean; approval: PullRequestApproval },
): boolean {
  if (pr.draft) return filter === 'draft'
  if (pr.approval === 'approved') return filter === 'approved'
  return filter === 'awaiting'
}

/**
 * The registered projects a My PRs read has to sweep. Narrowing here, before
 * any host is asked, is what keeps a filtered read cheap. An owner matches
 * case-insensitively, as both hosts treat it.
 */
export function projectsInScope(
  projects: readonly Project[],
  query: Pick<MyPullRequestsQuery, 'owner' | 'projectId'>,
): Project[] {
  const owner = query.owner?.toLowerCase()
  return projects.filter(
    (project) =>
      (query.projectId === undefined || project.id === query.projectId) &&
      (owner === undefined || project.owner.toLowerCase() === owner),
  )
}

/** Whether My PRs looks past the registered projects at all for this query. */
export function searchesBeyondProjects(
  query: Pick<MyPullRequestsQuery, 'scope' | 'projectId'>,
): boolean {
  return query.scope !== 'linked' && query.projectId === undefined
}

/**
 * The pull requests a host search found that no registered project accounts
 * for, within the owner filter. One in a registered repository is left to the
 * sweep of that project, even when the filter kept the project out of it.
 */
export function unlinkedPullRequests(
  found: readonly OpenPullRequest[],
  projects: readonly ProjectRef[],
  query: Pick<MyPullRequestsQuery, 'owner'>,
): OpenPullRequest[] {
  const registered = new Set(projects.map(repositoryKey))
  const owner = query.owner?.toLowerCase()
  return found.filter(
    (pr) =>
      !registered.has(repositoryKey(pr.pullRequest)) &&
      (owner === undefined || pr.pullRequest.owner.toLowerCase() === owner),
  )
}

/** Both hosts treat owner and repository names case-insensitively. */
function repositoryKey(ref: ProjectRef): string {
  return `${ref.provider}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`
}
