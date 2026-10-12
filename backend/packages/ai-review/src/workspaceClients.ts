import type { CatFactoryClient } from '@cat-factory/sdk'

/**
 * One cat-factory client per workspace, built on first use.
 *
 * A key reaching several workspaces is refused a workspace-scoped call that
 * names none (`422 workspace_required`), so a call about something filed in a
 * named workspace goes through a client that names it. Null is the key's only
 * workspace, asked through a client that names none.
 */
export class WorkspaceClients {
  private readonly named = new Map<string, CatFactoryClient>()
  private readonly unnamed: CatFactoryClient

  constructor(private readonly build: (workspaceId: string | undefined) => CatFactoryClient) {
    this.unnamed = build(undefined)
  }

  in(workspaceId: string | null): CatFactoryClient {
    if (workspaceId === null) return this.unnamed
    const held = this.named.get(workspaceId)
    if (held !== undefined) return held
    const client = this.build(workspaceId)
    this.named.set(workspaceId, client)
    return client
  }
}
