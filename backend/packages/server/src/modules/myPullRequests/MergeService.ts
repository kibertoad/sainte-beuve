import type {
  ConflictResolution,
  MergeMyPullRequest,
  MergeOutcome,
  PostMergeComment,
  Project,
  PullRequestStatus,
  ResolveConflicts,
  Viewer,
} from '@sainte-beuve/contracts'
import { handleOf } from '@sainte-beuve/contracts'
import {
  assertFound,
  ConflictError,
  ForbiddenError,
  type PullRequestAddress,
  UnavailableError,
  ValidationError,
  type VcsGateway,
} from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { resolveAiReview, VcsResolutions } from '../../integrations/resolve.js'
import type { RequestPrincipal } from '../auth/principal.js'
import { ViewerService } from '../identity/ViewerService.js'
import { catFactoryPlacementKeys } from '../projects/directoryKeys.js'
import { NO_CREDENTIAL } from '../workspace/sweep.js'
import {
  directMergeFor,
  type MergeContext,
  mergeContextOf,
  mergeCommentsFor,
} from './mergeContext.js'

/**
 * The two ways My PRs merges a pull request: directly, or by posting one of the
 * merge comments in force for a bot to act on.
 *
 * Both act with the deployment's credential for the host rather than the
 * viewer's own, so both re-read the pull request first and refuse one the
 * viewer did not author. The host still applies its own branch protection.
 */

/** An open pull request the viewer authored, as its host reports it now. */
interface Authored {
  viewer: Viewer
  project: Project
  address: PullRequestAddress
  gateway: VcsGateway
  status: PullRequestStatus
}

interface Target extends Authored {
  context: MergeContext
}

const NOT_YOURS =
  'My PRs only merges pull requests you opened. Ask the author, or merge it on the host.'

const RESTRICTED =
  'This repository merges through its merge comments. Post one of them instead, or ask an ' +
  'admin to merge it directly.'

const CONFIRM_OVERRIDE =
  'This repository merges through its merge comments. Confirm the override to merge directly.'

const NOT_YOURS_TO_RESOLVE =
  'My PRs only resolves conflicts on pull requests you opened. Ask the author to resolve them.'

const NO_CONFLICTS = 'This pull request has no conflicts with its base to resolve. Reload My PRs.'

const STILL_CHECKING =
  'The host is still checking whether this pull request conflicts with its base. Try again shortly.'

const NO_CAT_FACTORY =
  'cat-factory is not configured for this org: resolving conflicts needs its base URL and an ' +
  'API key, which an admin sets on the Configuration screen'

const MOVED =
  'The pull request has new commits since you loaded it. Reload My PRs and check them first.'

export class MergeService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async merge(input: MergeMyPullRequest): Promise<MergeOutcome> {
    const target = await this.target(input)
    const direct = directMergeFor(target.project, target.status, target.context)
    if (direct === 'not_mergeable') {
      throw new ConflictError(
        `The host will not merge this pull request yet (${target.status.mergeability}).`,
      )
    }
    if (direct === 'restricted') throw new ForbiddenError(RESTRICTED)
    if (direct === 'override' && !input.override) throw new ConflictError(CONFIRM_OVERRIDE)
    if (target.status.headSha !== input.expectedHeadSha) throw new ConflictError(MOVED)
    await target.gateway.merge(target.address, input.expectedHeadSha)
    this.container.logger.info(
      { projectId: target.project.id, number: input.number, override: direct === 'override' },
      'merged a pull request from My PRs',
    )
    return { outcome: 'merged' }
  }

  async postComment(input: PostMergeComment): Promise<MergeOutcome> {
    const target = await this.target(input)
    if (target.status.draft) {
      throw new ConflictError('A draft is not ready to merge. Mark it ready for review first.')
    }
    const { comments } = mergeCommentsFor(target.project, target.context)
    const inForce = comments.some(
      (comment) => comment.label === input.comment.label && comment.body === input.comment.body,
    )
    if (!inForce) {
      throw new ValidationError(
        'That is not one of the merge comments configured for this pull request. Reload My PRs.',
      )
    }
    await target.gateway.comment({ ...target.address, url: target.status.url }, input.comment.body)
    return { outcome: 'commented' }
  }

  /**
   * Hand a conflicting pull request to cat-factory, whose resolver merges the
   * base in and pushes the result to the pull request's own branch. The author's
   * call, as a merge is: it changes their branch.
   */
  async resolveConflicts(input: ResolveConflicts): Promise<ConflictResolution> {
    const catFactory = requireCapability(await resolveAiReview(this.container), NO_CAT_FACTORY)
    const { project, address, status } = await this.authored(input, NOT_YOURS_TO_RESOLVE)
    if (status.mergeability === 'checking') throw new ConflictError(STILL_CHECKING)
    if (status.mergeability !== 'conflicting') throw new ConflictError(NO_CONFLICTS)
    const pullRequest = { ...address, url: status.url }
    const handle = await catFactory.gateway.requestConflictResolution({
      pullRequest,
      ...(await catFactoryPlacementKeys(this.container, pullRequest)),
    })
    this.container.logger.info(
      { projectId: project.id, number: input.number, taskId: handle.taskId },
      'handed a conflicting pull request to cat-factory',
    )
    return { taskId: handle.taskId, url: handle.url }
  }

  private async target(input: { projectId: string; number: number }): Promise<Target> {
    const authored = await this.authored(input, NOT_YOURS)
    const context = await mergeContextOf(this.container, this.principal, authored.viewer)
    return { ...authored, context }
  }

  private async authored(
    input: { projectId: string; number: number },
    notYours: string,
  ): Promise<Authored> {
    const viewer = await new ViewerService(this.container, this.principal).current()
    const project = assertFound(
      await this.container.repositories.projects.getById(input.projectId),
      `No project ${input.projectId}`,
    )
    const gateway = await this.gatewayFor(project)
    const address = {
      provider: project.provider,
      owner: project.owner,
      repo: project.repo,
      number: input.number,
    }
    const status = await gateway.pullRequestStatus(address)
    if (!isSameHandle(handleOf(viewer.reviewer.handles, project.provider), status.authorLogin)) {
      throw new ForbiddenError(notYours)
    }
    if (status.state !== 'open') throw new ConflictError(`This pull request is ${status.state}.`)
    return { viewer, project, address, gateway, status }
  }

  private async gatewayFor(project: Project): Promise<VcsGateway> {
    const resolved = await new VcsResolutions(this.container).acting(project.provider)
    if (resolved === null)
      throw new UnavailableError(`Cannot reach ${project.provider}: ${NO_CREDENTIAL}`)
    return resolved.gateway
  }
}
