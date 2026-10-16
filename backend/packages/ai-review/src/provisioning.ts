import { CatFactoryForbiddenError } from '@cat-factory/sdk'
import type { PullRequestRef } from '@sainte-beuve/contracts'
import { formatPullRequest } from '@sainte-beuve/kernel'
import { locationOf } from './directoryKeys.js'
import type { Placement } from './placement.js'
import { refusalFor } from './refusals.js'
import type { WorkspaceClients } from './workspaceClients.js'

/**
 * A repository no cat-factory workspace links, linked into one and given a
 * service there, so a task can be filed under its own service.
 *
 * Null when it cannot be done here and the caller should fall back: no single
 * workspace to link into, a monorepo (whose services are per directory, a
 * person's choice), or a key below `admin`, which cat-factory requires to
 * create a service. A repository the connection cannot reach is refused, since
 * no fallback would file its task in the right place either.
 */
export async function provisionService(
  clients: WorkspaceClients,
  request: { pullRequest: PullRequestRef; ownerDirectoryKeys: readonly string[] },
): Promise<Placement | null> {
  const { pullRequest } = request
  const workspaceId = ownersWorkspace(request.ownerDirectoryKeys) ?? (await soleWorkspace(clients))
  if (workspaceId === null) return null
  const client = clients.in(workspaceId)
  let linked: Awaited<ReturnType<typeof client.repos.link>>
  try {
    linked = await client.repos.link({ owner: pullRequest.owner, name: pullRequest.repo })
  } catch (err) {
    throw refusalFor(err, `link ${formatPullRequest(pullRequest)}'s repository in cat-factory`)
  }
  if (linked.serviceId !== null) return { serviceId: linked.serviceId, workspaceId }
  if (linked.monorepo) return null
  try {
    const service = await client.services.create({
      title: pullRequest.repo,
      repo: { repoId: linked.repoId },
    })
    return { serviceId: service.serviceId, workspaceId }
  } catch (err) {
    if (err instanceof CatFactoryForbiddenError) return null
    throw refusalFor(err, `create a cat-factory service for ${formatPullRequest(pullRequest)}`)
  }
}

/** The workspace most of the owner's other repositories are linked in, the first by id on a tie. */
function ownersWorkspace(keys: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const workspaceId = locationOf(key)?.workspaceId
    if (workspaceId !== undefined) counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1)
  }
  const ranked = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  return ranked[0]?.[0] ?? null
}

/** The one workspace the key reaches, or null when it reaches several or cannot say. */
async function soleWorkspace(clients: WorkspaceClients): Promise<string | null> {
  try {
    const client = clients.in(null)
    const { workspaceIds } = await client.directory.getReach()
    if (workspaceIds !== null) return workspaceIds.length === 1 ? (workspaceIds[0] ?? null) : null
    const reached: string[] = []
    for await (const workspace of client.directory.listWorkspacesAll()) {
      reached.push(workspace.id)
      if (reached.length > 1) return null
    }
    return reached[0] ?? null
  } catch {
    // A key that may not read its reach has nowhere this can choose for it.
    return null
  }
}
