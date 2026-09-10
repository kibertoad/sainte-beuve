import type { CreateProject, Project, UpdateProject } from '@sainte-beuve/contracts'
import { DEFAULT_PROJECT_SKILLS } from '@sainte-beuve/contracts'
import { ConflictError, assertFound } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'

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
    return repositories.projects.create({
      id: ids.next(),
      provider: input.provider,
      owner: input.owner,
      repo: input.repo,
      webUrl: input.webUrl,
      // Absent means the defaults; an explicit empty list means a team that
      // wants no skill vocabulary, and the two must not collapse into one.
      skills: input.skills ?? [...DEFAULT_PROJECT_SKILLS],
      createdAt: clock.now(),
    })
  }

  async update(projectId: string, patch: UpdateProject): Promise<Project> {
    return assertFound(
      await this.container.repositories.projects.update(projectId, patch),
      `No project ${projectId}`,
    )
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
