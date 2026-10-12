import type {
  ExternalRepository,
  ExternalRepositoryRef,
  Project,
  ProjectRef,
} from '@sainte-beuve/contracts'
import { projectRefKey } from '@sainte-beuve/kernel'

type Listed = NonNullable<ExternalRepository['repository']>

/** What a source's repository list asks of the org's projects. */
export interface ProjectSyncPlan {
  /** Projects the source no longer lists, local ones included. */
  remove: string[]
  /** Projects whose repository the source now lists under another owner or name. */
  rename: { projectId: string; owner: string; repo: string }[]
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
 * deleted and recreated on the host is) is not created twice.
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
  return plan
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
