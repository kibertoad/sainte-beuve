import type {
  MyPullRequest,
  MyPullRequests,
  MyPullRequestsQuery,
  MyPullRequestStatusFilter,
  OpenPullRequest,
  Project,
  PullRequestStatus,
} from '@sainte-beuve/contracts'
import { MY_PULL_REQUESTS_LIMIT } from '@sainte-beuve/contracts'
import { getErrorMessage, type VcsGateway } from '@sainte-beuve/kernel'
import { matchesStatusFilter, partitionForViewer, projectsInScope } from '@sainte-beuve/reviewers'
import { mapWithConcurrency } from '../../concurrency.js'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { sweepProjects } from '../workspace/sweep.js'
import { type MergeContext, mergeContextOf, toMyPullRequest } from './mergeContext.js'

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
  project: Project
}

interface StatusRead {
  status: PullRequestStatus | null
  error: string | null
}

/** The viewer's own open pull requests, newest activity first, with what merging each takes. */
export class MyPullRequestsService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async list(query: MyPullRequestsQuery): Promise<MyPullRequests> {
    const resolutions = new VcsResolutions(this.container)
    const viewer = await new ViewerService(this.container, this.principal, resolutions).current()
    const projects = projectsInScope(await this.container.repositories.projects.list(), query)
    const reads = await sweepProjects(this.container, resolutions, projects)
    const projectOf = new Map<OpenPullRequest, Project>()
    for (const read of reads) {
      for (const pullRequest of read.pullRequests) projectOf.set(pullRequest, read.project)
    }
    const filter = query.status ?? 'awaiting'
    const candidates = partitionForViewer([...projectOf.keys()], viewer.reviewer.handles)
      .authored.filter((pullRequest) => pullRequest.draft === (filter === 'draft'))
      .flatMap((pullRequest): Candidate[] => {
        const project = projectOf.get(pullRequest)
        return project === undefined ? [] : [{ pullRequest, project }]
      })
    const gateways = new Map<string, VcsGateway | null>()
    for (const provider of new Set(candidates.map((candidate) => candidate.project.provider))) {
      gateways.set(provider, (await resolutions.acting(provider))?.gateway ?? null)
    }
    const context = await mergeContextOf(this.container, this.principal, viewer)
    const { rows, complete } = await this.collect(candidates, filter, gateways, context)
    return { pullRequests: rows, complete, sources: reads.map((read) => read.source) }
  }

  /**
   * Read statuses a page at a time until the filter has its fill or the budget
   * runs out. A pull request whose status could not be read stays under
   * `awaiting`, since nothing says it was approved.
   */
  private async collect(
    candidates: readonly Candidate[],
    filter: MyPullRequestStatusFilter,
    gateways: ReadonlyMap<string, VcsGateway | null>,
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
        this.readStatus(candidate, gateways.get(candidate.project.provider) ?? null),
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

  private async readStatus(candidate: Candidate, gateway: VcsGateway | null): Promise<StatusRead> {
    if (gateway === null) return { status: null, error: 'no credential for this host' }
    const { provider, owner, repo, number } = candidate.pullRequest.pullRequest
    try {
      return {
        status: await gateway.pullRequestStatus({ provider, owner, repo, number }),
        error: null,
      }
    } catch (err) {
      this.container.logger.warn(
        { err, projectId: candidate.project.id, number },
        'could not read the status of a pull request',
      )
      return { status: null, error: getErrorMessage(err) }
    }
  }
}
