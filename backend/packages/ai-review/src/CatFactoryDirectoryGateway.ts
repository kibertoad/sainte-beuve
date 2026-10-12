import {
  type DirectoryRecord,
  type DirectoryStore,
  DirectorySyncer,
  type SyncResult,
} from '@cat-factory/directory-sync'
import { CatFactoryClient } from '@cat-factory/sdk'
import {
  type CatFactoryAccess,
  type RepositoryDirectoryGateway,
  type DirectoryDeliveryOutcome,
  type DirectorySyncReport,
  type ExternalRepositoryEntry,
  type RepositoryDirectoryStore,
  withDeadline,
} from '@sainte-beuve/kernel'
import { refusalFor } from './refusals.js'

export interface CatFactoryDirectoryOptions extends CatFactoryAccess {
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
  /** The clock a push's timestamp is checked against. */
  now?: () => number
}

/**
 * The repositories linked in an account's cat-factory workspaces, kept in step
 * through `@cat-factory/directory-sync`. Only repository records reach the
 * store; the users, workspaces and memberships the directory also carries are
 * read past and dropped.
 */
export class CatFactoryDirectoryGateway implements RepositoryDirectoryGateway {
  private readonly client: CatFactoryClient
  private readonly now: () => number

  constructor(options: CatFactoryDirectoryOptions) {
    this.client = new CatFactoryClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      userAgent: 'sainte-beuve',
      fetch: withDeadline(options.fetch),
    })
    this.now = options.now ?? Date.now
  }

  catchUp(store: RepositoryDirectoryStore): Promise<DirectorySyncReport> {
    return this.relay('follow the directory change feed', () =>
      this.syncer(store).catchUp().then(reportOf),
    )
  }

  reconcile(store: RepositoryDirectoryStore): Promise<DirectorySyncReport> {
    return this.relay('read the directory snapshots', () =>
      this.syncer(store).reconcile().then(reportOf),
    )
  }

  async receive(
    store: RepositoryDirectoryStore,
    delivery: { headers: Headers; rawBody: string; secret: string },
  ): Promise<DirectoryDeliveryOutcome> {
    const result = await this.relay('apply a directory push', () =>
      this.syncer(store, delivery.secret).handleDelivery(delivery.headers, delivery.rawBody),
    )
    return result.ok ? { ok: true, event: result.event, sync: reportOf(result.sync) } : result
  }

  async registerWebhook(input: { webhookId: string; url: string; secret: string }): Promise<void> {
    await this.relay(
      'register a directory webhook',
      () =>
        this.client.directory.putWebhook(input.webhookId, {
          url: input.url,
          secret: input.secret,
          enabled: true,
        }),
      'admin',
    )
  }

  async removeWebhook(webhookId: string): Promise<void> {
    await this.relay(
      'remove a directory webhook',
      () => this.client.directory.deleteWebhook(webhookId),
      'admin',
    )
  }

  private syncer(store: RepositoryDirectoryStore, webhookSecret?: string): DirectorySyncer {
    return new DirectorySyncer({
      client: this.client,
      store: repositoriesOnly(store),
      now: this.now,
      ...(webhookSecret === undefined ? {} : { webhookSecret }),
    })
  }

  private async relay<T>(
    what: string,
    call: () => Promise<T>,
    scope: 'read' | 'admin' = 'read',
  ): Promise<T> {
    try {
      return await call()
    } catch (err) {
      throw refusalFor(err, what, scope)
    }
  }
}

function reportOf(result: SyncResult): DirectorySyncReport {
  return { cursor: result.cursor, reconciled: result.reconciled }
}

/** The directory store the syncer writes to, holding repository records only. */
function repositoriesOnly(store: RepositoryDirectoryStore): DirectoryStore {
  return {
    getCursor: () => store.getCursor(),
    setCursor: (seq) => store.setCursor(seq),
    apply: async (record) => {
      const entry = entryOf(record)
      if (entry !== null) await store.apply(entry)
    },
    listKeys: async (entityType) => (entityType === 'repo' ? store.liveKeys() : []),
  }
}

function entryOf(record: DirectoryRecord): ExternalRepositoryEntry | null {
  if (record.entityType !== 'repo') return null
  const repo = record.entity
  return {
    key: record.key,
    seq: record.seq,
    repository:
      repo === null
        ? null
        : { provider: repo.provider, owner: repo.owner, repo: repo.name, id: String(repo.repoId) },
  }
}
