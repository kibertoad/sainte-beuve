import type {
  Project,
  ReviewReport,
  ReviewReportQuery,
  VcsProvider,
  WorkspaceSource,
} from '@sainte-beuve/contracts'
import { DEFAULT_REPORT_WINDOW } from '@sainte-beuve/contracts'
import {
  getErrorMessage,
  NotFoundError,
  type PullRequestTimeline,
  type VcsGateway,
} from '@sainte-beuve/kernel'
import { buildReviewReport } from '@sainte-beuve/reporting'
import { mapWithConcurrency } from '../../concurrency.js'
import type { AppContainer } from '../../container.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import { gatewaysByProvider, NO_CREDENTIAL } from '../workspace/sweep.js'

/**
 * How many repositories are read at once. Each read is a few GraphQL pages
 * carrying every review, so a wide org is a queue rather than a burst against
 * the host's rate limit.
 */
const REPOSITORY_FAN_OUT = 4

const DAY_MS = 24 * 60 * 60 * 1000

interface RepositoryRead {
  project: Project
  pullRequests: PullRequestTimeline[]
  source: ReviewReport['sources'][number]
}

/**
 * Reports: how long the pull requests opened in a window waited for a review, a
 * human review, an approval and a merge, read from the hosts at the time of
 * asking. Nothing is stored, so a report covers history from before this
 * deployment tracked anything, and a repository the host will not read is
 * reported per source rather than failing the rest.
 */
export class ReportingService {
  constructor(private readonly container: AppContainer) {}

  async report(query: ReviewReportQuery = {}): Promise<ReviewReport> {
    const days = Number(query.days ?? DEFAULT_REPORT_WINDOW)
    const projects = await this.projectsFor(query.projectId)
    const now = this.container.clock.now()
    const reads = await this.readTimelines(projects, now - days * DAY_MS)
    const computed = buildReviewReport({
      repositories: reads.map(({ project, pullRequests }) => ({ project, pullRequests })),
      days,
      now,
      projectId: query.projectId ?? null,
    })
    return { ...computed, sources: reads.map((read) => read.source) }
  }

  private async projectsFor(projectId: string | undefined): Promise<Project[]> {
    const { projects } = this.container.repositories
    if (projectId === undefined) return projects.list()
    const project = await projects.getById(projectId)
    if (project === null) throw new NotFoundError(`No linked repository ${projectId}`)
    return [project]
  }

  private async readTimelines(projects: readonly Project[], since: number) {
    const gateways = await gatewaysByProvider(new VcsResolutions(this.container), projects)
    return mapWithConcurrency(projects, REPOSITORY_FAN_OUT, (project) =>
      this.readProject(project, since, gateways),
    )
  }

  private async readProject(
    project: Project,
    since: number,
    gateways: Map<VcsProvider, VcsGateway>,
  ): Promise<RepositoryRead> {
    const gateway = gateways.get(project.provider)
    if (gateway === undefined) {
      return { project, pullRequests: [], source: sourceOf(project, false, NO_CREDENTIAL) }
    }
    try {
      const { pullRequests, truncated } = await gateway.reviewTimelines(project, since)
      return { project, pullRequests, source: sourceOf(project, truncated) }
    } catch (err) {
      this.container.logger.warn(
        { err, projectId: project.id },
        'could not read the review history of a project',
      )
      return {
        project,
        pullRequests: [],
        source: sourceOf(project, false, getErrorMessage(err)),
      }
    }
  }
}

function sourceOf(
  project: Project,
  truncated: boolean,
  reason?: string,
): WorkspaceSource & { truncated: boolean } {
  return {
    projectId: project.id,
    provider: project.provider,
    owner: project.owner,
    repo: project.repo,
    ok: reason === undefined,
    reason: reason ?? null,
    truncated,
  }
}
