import { type DirectoryStore, DirectorySyncer, type SyncResult } from '@cat-factory/directory-sync'
import { CatFactoryClient } from '@cat-factory/sdk'
import type { DirectoryReach } from '@sainte-beuve/contracts'
import {
  type CatFactoryAccess,
  type DirectoryDeliveryOutcome,
  type DirectoryMirrorStore,
  type DirectorySyncReport,
  type RepositoryDirectoryGateway,
  withDeadline,
} from '@sainte-beuve/kernel'
import { mirrorEntryOf, mirrorListOf } from './directoryEntries.js'
import { refusalFor } from './refusals.js'

export interface CatFactoryDirectoryOptions extends CatFactoryAccess {
  /** Swap the HTTP implementation. The SDK's own seam, so a suite needs no live instance. */
  fetch?: typeof globalThis.fetch
  /** The clock a push's timestamp is checked against. */
  now?: () => number
}

/**
 * An account's cat-factory directory, kept in step through
 * `@cat-factory/directory-sync`: the repositories its workspaces link, and its
 * users, workspaces and workspace memberships as people, groups and
 * memberships. See `mirrorEntryOf` for the mapping.
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

  catchUp(store: DirectoryMirrorStore): Promise<DirectorySyncReport> {
    return this.relay('follow the directory change feed', async () =>
      this.reportOf(await this.syncer(store).catchUp()),
    )
  }

  reconcile(store: DirectoryMirrorStore): Promise<DirectorySyncReport> {
    return this.relay('read the directory snapshots', async () =>
      this.reportOf(await this.syncer(store).reconcile()),
    )
  }

  async receive(
    store: DirectoryMirrorStore,
    delivery: { headers: Headers; rawBody: string; secret: string },
  ): Promise<DirectoryDeliveryOutcome> {
    return this.relay('apply a directory push', async () => {
      const result = await this.syncer(store, delivery.secret).handleDelivery(
        delivery.headers,
        delivery.rawBody,
      )
      return result.ok
        ? { ok: true, event: result.event, sync: await this.reportOf(result.sync) }
        : result
    })
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

  /**
   * The report, with the key's reach after a snapshot walk. The syncer skips the
   * account-wide snapshots a key limited to some workspaces is refused, so the
   * reach is what tells "no users" apart from "users this key may not read".
   */
  private async reportOf(result: SyncResult): Promise<DirectorySyncReport> {
    const reach: DirectoryReach | null = result.reconciled
      ? (await this.client.me.get()).workspaceIds === null
        ? 'account'
        : 'workspaces'
      : null
    return { cursor: result.cursor, reconciled: result.reconciled, reach }
  }

  private syncer(store: DirectoryMirrorStore, webhookSecret?: string): DirectorySyncer {
    return new DirectorySyncer({
      client: this.client,
      store: mirrorOf(store),
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

/** The directory store the syncer writes to: the mirror's two lists behind one cursor. */
function mirrorOf(store: DirectoryMirrorStore): DirectoryStore {
  return {
    getCursor: () => store.getCursor(),
    setCursor: (seq) => store.setCursor(seq),
    apply: async (record) => {
      const mirrored = mirrorEntryOf(record)
      if (mirrored === null) return
      if (mirrored.list === 'repositories') await store.apply(mirrored.entry)
      else await store.applyDirectory(mirrored.entry)
    },
    listKeys: async (entityType) => {
      const list = mirrorListOf(entityType)
      if (list === null) return []
      return list.list === 'repositories' ? store.liveKeys() : store.liveDirectoryKeys(list.kind)
    },
  }
}
