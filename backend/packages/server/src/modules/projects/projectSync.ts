import type {
  ExternalRepository,
  ExternalRepositoryRef,
  Project,
  ProjectRef,
} from '@sainte-beuve/contracts'
import { projectRefKey } from '@sainte-beuve/kernel'

type Listed = NonNullable<ExternalRepository['repository']>

interface Rename {
  projectId: string
  owner: string
  repo: string
}

/** A name no repository has, held for one step while two projects swap names. */
const PARKING_PREFIX = 'sainte-beuve-renaming-'

/** What a source's repository list asks of the org's projects. */
export interface ProjectSyncPlan {
  /** Projects the source no longer lists, local ones included. */
  remove: string[]
  /**
   * Projects whose repository the source now lists under another owner or name,
   * as steps to take in order. A project appears twice when it passes through a
   * parking name to free its own for another project.
   */
  rename: Rename[]
  /** Projects registered here before the source listed them, now taken over by it. */
  adopt: { projectId: string; external: ExternalRepositoryRef }[]
  create: (ProjectRef & { external: ExternalRepositoryRef })[]
}

/**
 * The changes that make the org's projects the repositories one source lists.
 *
 * A repository listed under several keys is one project. A project is matched
 * by the source's id first, so a rename keeps its skills and domains, then by
 * owner and repo. Every project left over is removed, because while the source
 * is on it decides which repositories the org watches. A project another
 * source put here is left alone. A repository whose owner and repo a kept
 * project already holds (the same name under a second id, as a repository
 * deleted and recreated on the host is) is not created twice, and a project
 * is not renamed onto a name another project keeps.
 */
export function planProjectSync(
  source: string,
  projects: readonly Project[],
  entries: readonly ExternalRepository[],
): ProjectSyncPlan {
  const listed = listedById(entries)
  const plan: ProjectSyncPlan = { remove: [], rename: [], adopt: [], create: [] }
  const taken = new Set(
    projects.filter((p) => isFrom(p, source) === 'other').map((p) => projectRefKey(p)),
  )
  for (const project of projects.filter((p) => isFrom(p, source) === 'source')) {
    const repository = listed.get(idKey(project.provider, project.external?.id ?? ''))
    if (repository === undefined) plan.remove.push(project.id)
    else {
      listed.delete(idKey(repository.provider, repository.id))
      taken.add(refKeyOf(repository))
      if (projectRefKey(project) !== refKeyOf(repository)) {
        plan.rename.push({ projectId: project.id, owner: repository.owner, repo: repository.repo })
      }
    }
  }
  const byRef = new Map([...listed.values()].map((r) => [refKeyOf(r), r]))
  for (const project of projects.filter((p) => isFrom(p, source) === 'local')) {
    const repository = byRef.get(projectRefKey(project))
    if (repository === undefined) plan.remove.push(project.id)
    else {
      listed.delete(idKey(repository.provider, repository.id))
      taken.add(projectRefKey(project))
      plan.adopt.push({ projectId: project.id, external: { source, id: repository.id } })
    }
  }
  for (const { provider, owner, repo, id } of listed.values()) {
    const ref = projectRefKey({ provider, owner, repo })
    if (taken.has(ref)) continue
    taken.add(ref)
    plan.create.push({ provider, owner, repo, external: { source, id } })
  }
  const removed = new Set(plan.remove)
  plan.rename = orderRenames(
    plan.rename,
    projects.filter((p) => !removed.has(p.id)),
  )
  return plan
}

/**
 * The renames as steps that never land on a name another project holds at that
 * moment, so the unique owner/repo of a project is never violated mid-plan.
 * Projects that swap names go through a parking name; a rename onto a name a
 * project keeps is dropped, because it could only fail.
 */
function orderRenames(renames: readonly Rename[], kept: readonly Project[]): Rename[] {
  const board = new NameBoard(kept)
  let pending = feasible(renames, board)
  const steps: Rename[] = []
  for (;;) {
    const [first] = pending
    if (first === undefined) return steps
    const free = pending.find((step) => board.holderOf(step) === undefined)
    const step = free ?? { ...first, repo: `${PARKING_PREFIX}${first.projectId}` }
    board.move(step)
    steps.push(step)
    if (free !== undefined) pending = pending.filter((other) => other !== free)
  }
}

/** The renames whose target is free or held by a project that is itself moving. */
function feasible(renames: readonly Rename[], board: NameBoard): Rename[] {
  let left = [...renames]
  for (;;) {
    const moving = new Set(left.map((step) => step.projectId))
    const next = left.filter((step) => {
      const holder = board.holderOf(step)
      return holder === undefined || moving.has(holder)
    })
    if (next.length === left.length) return next
    left = next
  }
}

/** Which project holds which owner/repo, as renames are taken one at a time. */
class NameBoard {
  private readonly holders = new Map<string, string>()
  private readonly names = new Map<string, string>()
  private readonly providers = new Map<string, string>()

  constructor(projects: readonly Project[]) {
    for (const project of projects) {
      this.providers.set(project.id, project.provider)
      this.hold(project.id, projectRefKey(project))
    }
  }

  holderOf(step: Rename): string | undefined {
    return this.holders.get(this.keyOf(step))
  }

  move(step: Rename): void {
    const from = this.names.get(step.projectId)
    if (from !== undefined) this.holders.delete(from)
    this.hold(step.projectId, this.keyOf(step))
  }

  private hold(projectId: string, key: string): void {
    this.holders.set(key, projectId)
    this.names.set(projectId, key)
  }

  private keyOf(step: Rename): string {
    const provider = this.providers.get(step.projectId) ?? ''
    return projectRefKey({ provider, owner: step.owner, repo: step.repo })
  }
}

function isFrom(project: Project, source: string): 'source' | 'local' | 'other' {
  if (project.external === undefined || project.external === null) return 'local'
  return project.external.source === source ? 'source' : 'other'
}

function listedById(entries: readonly ExternalRepository[]): Map<string, Listed> {
  const listed = new Map<string, Listed>()
  for (const { repository } of entries) {
    if (repository !== null) listed.set(idKey(repository.provider, repository.id), repository)
  }
  return listed
}

function idKey(provider: string, id: string): string {
  return `${provider}:${id}`
}

function refKeyOf(repository: Listed): string {
  return projectRefKey({
    provider: repository.provider,
    owner: repository.owner,
    repo: repository.repo,
  })
}
