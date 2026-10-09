import type { CreateProject, Project, UpdateProject } from '@sainte-beuve/contracts'
import { DEFAULT_PROJECT_SKILLS } from '@sainte-beuve/contracts'
import { ConflictError, assertFound } from '@sainte-beuve/kernel'
import { mergeVocabulary } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { OrgService } from '../orgs/OrgService.js'

/**
 * The projects a workspace watches.
 *
 * Registering one is deliberately cheap: no credential check, no call to the
 * host. A project can be registered before the host is connected, and the
 * workspace reports per project whether it could actually be read, which is
 * the only order that works for somebody setting a deployment up. Refusing to
 * register until a token exists would make the Configuration screen a
 * precondition for the screen that explains why you need one.
 */
export class ProjectService {
  constructor(private readonly container: AppContainer) {}

  async list(): Promise<Project[]> {
    return this.container.repositories.projects.list()
  }

  async add(input: CreateProject): Promise<Project> {
    const { repositories, clock, ids } = this.container
    const existing = await repositories.projects.getByRef(input)
    if (existing !== null) {
      throw new ConflictError(`${input.owner}/${input.repo} is already registered`, {
        projectId: existing.id,
      })
    }
    await this.refuseIfAnotherOrgClaimedIt(input)
    return repositories.projects.create({
      id: ids.next(),
      provider: input.provider,
      owner: input.owner,
      repo: input.repo,
      webUrl: input.webUrl,
      // Absent means the defaults; an explicit empty list means a team that
      // wants no skill vocabulary, and the two must not collapse into one.
      skills: input.skills ?? [...DEFAULT_PROJECT_SKILLS],
      domains: await this.inOrgVocabulary(input.domains),
      mergeComments: null,
      restrictDirectMerge: false,
      createdAt: clock.now(),
    })
  }

  /**
   * A repository is CLAIMED by the org that registered it first, and a second
   * org may not register it at all.
   *
   * The only read in this service that goes outside the bound store, and the
   * boundary is exactly why it has to: an inbound delivery carries no credential
   * of ours, so `findOrgIdForProject` places it in the oldest claim across every
   * tenancy (see `TenancyDirectory`). Without this, an org that registers
   * `acme/payments` before its real owner does receives every delivery about
   * that repository — its board gets the pull requests, its reviewers are
   * requested on them, and its cat-factory key pays for the AI reviews — and the
   * real owner can never take the claim back, because the conflict above only
   * sees its own org's rows.
   *
   * The refusal names no org. Which tenancy holds a claim is not a member's
   * business, and answering with it would turn this route into a way to
   * enumerate the deployment.
   */
  private async refuseIfAnotherOrgClaimedIt(input: CreateProject): Promise<void> {
    const holder = await this.container.stores.tenancy.findOrgIdForProject(input)
    if (holder === null || holder === this.container.orgId) return
    throw new ConflictError(
      `${input.owner}/${input.repo} is registered by another org on this deployment. ` +
        'A repository belongs to whichever org registered it first, because an inbound ' +
        'delivery carries nothing else that could place it.',
    )
  }

  async update(projectId: string, patch: UpdateProject): Promise<Project> {
    const { projects } = this.container.repositories
    assertFound(await projects.getById(projectId), `No project ${projectId}`)
    const next =
      patch.domains === undefined
        ? patch
        : { ...patch, domains: await this.inOrgVocabulary(patch.domains) }
    return assertFound(await projects.update(projectId, next), `No project ${projectId}`)
  }

  /**
   * The domains in the org's spelling, after adding to the org's list any it
   * did not have. A repository is where a new domain is usually first named, so
   * naming it here is what puts it on offer to the reviewers who know it.
   */
  private async inOrgVocabulary(domains: readonly string[]): Promise<string[]> {
    if (domains.length === 0) return []
    const orgs = new OrgService(this.container)
    const org = await orgs.current()
    const merged = mergeVocabulary(org.domains, domains)
    if (merged.added.length > 0) await orgs.update({ domains: [...org.domains, ...merged.added] })
    return merged.values
  }

  /**
   * Stop watching a project. Its pull requests leave the workspace with it;
   * commitments and board rows are untouched, because those are promises
   * people made and un-registering a repository is not a way to withdraw one.
   */
  async remove(projectId: string): Promise<Project[]> {
    const { repositories } = this.container
    assertFound(await repositories.projects.getById(projectId), `No project ${projectId}`)
    await repositories.projects.delete(projectId)
    return repositories.projects.list()
  }
}
