import type {
  MyPullRequest,
  MyPullRequests,
  MyPullRequestsQuery,
  MyPullRequestStatusFilter,
  OpenPullRequest,
  Project,
  PullRequestStatus,
  Viewer,
} from '@sainte-beuve/contracts'
import { MY_PULL_REQUESTS_LIMIT } from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import {
  matchesStatusFilter,
  partitionForViewer,
  projectsInScope,
  searchesBeyondProjects,
  unlinkedPullRequests,
} from '@sainte-beuve/reviewers'
import { mapWithConcurrency } from '../../concurrency.js'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { type ProjectRead, sweepProjects } from '../workspace/sweep.js'
import { type MergeContext, mergeContextOf, toMyPullRequest } from './mergeContext.js'
import { type AuthoredSearch, NO_SEARCH, searchAuthored } from './search.js'

/**
 * How many statuses one read asks the hosts for at most. Neither host puts
 * approvals on its list, so each candidate costs two calls, and a viewer with
 * fifty open pull requests that are all approved must not spend a hundred to
 * learn the awaiting filter is empty.
 */
const STATUS_READ_LIMIT = 30

const STATUS_CONCURRENCY = 5

interface Candidate {
  pullRequest: OpenPullRequest
  /** Null for a pull request the host search found outside the registered projects. */
  project: Project | null
  gateway: VcsGateway | null
}

interface StatusRead {
  status: PullRequestStatus | null
  error: string | null
}

/**
 * The viewer's own open pull requests, newest activity first, with what merging
 * each takes: those in the registered projects, and by default those the hosts
 * find anywhere else the viewer authored one.
 */
export class MyPullRequestsService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async list(query: MyPullRequestsQuery): Promise<MyPullRequests> {
    const resolutions = new VcsResolutions(this.container)
    const viewer = await new ViewerService(this.container, this.principal, resolutions).current()
    const registered = await this.container.repositories.projects.list()
    const [reads, search] = await Promise.all([
      sweepProjects(this.container, resolutions, projectsInScope(registered, query)),
      searchesBeyondProjects(query)
        ? searchAuthored(this.container, resolutions, viewer)
        : NO_SEARCH,
    ])
    const filter = query.status ?? 'awaiting'
    const candidates = [
      ...(await this.linked(reads, viewer, resolutions)),
      ...this.unlinked(search, registered, query),
    ]
      .filter((candidate) => candidate.pullRequest.draft === (filter === 'draft'))
      .sort((a, b) => b.pullRequest.updatedAt - a.pullRequest.updatedAt)
    const context = await mergeContextOf(this.container, this.principal, viewer)
    const { rows, complete } = await this.collect(candidates, filter, context)
    return {
      pullRequests: rows,
      complete,
      sources: reads.map((read) => read.source),
      searches: search.searches,
    }
  }

  /** The viewer's pull requests in the swept projects, read with the credential calls are made with. */
  private async linked(
    reads: readonly ProjectRead[],
    viewer: Viewer,
    resolutions: VcsResolutions,
  ): Promise<Candidate[]> {
    const projectOf = new Map<OpenPullRequest, Project>()
    for (const read of reads) {
      for (const pullRequest of read.pullRequests) projectOf.set(pullRequest, read.project)
    }
    const authored = partitionForViewer([...projectOf.keys()], viewer.reviewer.handles).authored
    const gateways = new Map<string, VcsGateway | null>()
    for (const provider of new Set(authored.map((pr) => pr.pullRequest.provider))) {
      gateways.set(provider, (await resolutions.acting(provider))?.gateway ?? null)
    }
    return authored.flatMap((pullRequest): Candidate[] => {
      const project = projectOf.get(pullRequest)
      const gateway = gateways.get(pullRequest.pullRequest.provider) ?? null
      return project === undefined ? [] : [{ pullRequest, project, gateway }]
    })
  }

  /** What the search found outside every registered project, read with the credential that found it. */
  private unlinked(
    search: AuthoredSearch,
    registered: readonly Project[],
    query: MyPullRequestsQuery,
  ): Candidate[] {
    const gatewayOf = new Map(search.found.map((hit) => [hit.pullRequest, hit.gateway]))
    const kept = unlinkedPullRequests(
      search.found.map((hit) => hit.pullRequest),
      registered,
      query,
    )
    return kept.map((pullRequest) => ({
      pullRequest,
      project: null,
      gateway: gatewayOf.get(pullRequest) ?? null,
    }))
  }

  /**
   * Read statuses a page at a time until the filter has its fill or the budget
   * runs out. A pull request whose status could not be read stays under
   * `awaiting`, since nothing says it was approved.
   */
  private async collect(
    candidates: readonly Candidate[],
    filter: MyPullRequestStatusFilter,
    context: MergeContext,
  ): Promise<{ rows: MyPullRequest[]; complete: boolean }> {
    const rows: MyPullRequest[] = []
    let next = 0
    while (rows.length < MY_PULL_REQUESTS_LIMIT && next < candidates.length) {
      if (next >= STATUS_READ_LIMIT) return { rows, complete: false }
      const page = candidates.slice(
        next,
        Math.min(next + MY_PULL_REQUESTS_LIMIT, STATUS_READ_LIMIT),
      )
      next += page.length
      const statuses = await mapWithConcurrency(page, STATUS_CONCURRENCY, (candidate) =>
        this.readStatus(candidate),
      )
      page.forEach((candidate, index) => {
        const read = statuses[index] ?? { status: null, error: null }
        if (rows.length < MY_PULL_REQUESTS_LIMIT && this.matches(filter, candidate, read)) {
          rows.push(toMyPullRequest(candidate, read, context))
        }
      })
    }
    return { rows, complete: true }
  }

  private matches(
    filter: MyPullRequestStatusFilter,
    candidate: Candidate,
    read: StatusRead,
  ): boolean {
    if (read.status === null) return filter !== 'approved'
    return matchesStatusFilter(filter, {
      draft: candidate.pullRequest.draft,
      approval: read.status.approval,
    })
  }

  private async readStatus(candidate: Candidate): Promise<StatusRead> {
    const { gateway } = candidate
    if (gateway === null) return { status: null, error: 'no credential for this host' }
    const { provider, owner, repo, number } = candidate.pullRequest.pullRequest
    try {
      return {
        status: await gateway.pullRequestStatus({ provider, owner, repo, number }),
        error: null,
      }
    } catch (err) {
      this.container.logger.warn(
        { err, projectId: candidate.project?.id ?? null, owner, repo, number },
        'could not read the status of a pull request',
      )
      return { status: null, error: getErrorMessage(err) }
    }
  }
}
