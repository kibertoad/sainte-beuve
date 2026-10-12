import { catFactoryWebhookPath, repositorySyncSecretKey } from '@sainte-beuve/contracts'
import {
  type DirectoryDeliveryOutcome,
  type RepositoryDirectoryGateway,
  type RepositoryDirectoryStore,
  base64url,
  getErrorMessage,
} from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { openCredential, repositoryDirectoryAccess } from '../../integrations/resolve.js'
import {
  type RepositorySyncState,
  clearRepositorySyncState,
  readRepositorySyncState,
  writeRepositorySyncState,
} from '../../integrations/repositorySyncState.js'
import { OrgService } from '../orgs/OrgService.js'
import { planProjectSync } from './projectSync.js'
import { ProjectService } from './ProjectService.js'

/** The source this service follows. The store and the planner take any. */
export const CAT_FACTORY_SOURCE = 'cat-factory'

const CATCH_UP_EVERY_MS = 5 * 60_000
const RECONCILE_EVERY_MS = 24 * 60 * 60_000

/**
 * Said instead of removing every project when the source has never listed a
 * repository: that is far more often a key that reaches no workspace than an org
 * with nothing linked. An unlink leaves a dropped entry, so it still removes.
 */
const NOTHING_LISTED =
  'cat-factory lists no repository in any workspace this key reaches, so no project was ' +
  'removed. Link a repository in cat-factory, or check which workspaces the key belongs to.'

/**
 * Keeps an org's projects to the repositories linked in its cat-factory
 * workspaces, for as long as cat-factory is configured.
 *
 * The change feed is the guarantee and is followed on the clock; a push from
 * cat-factory only makes the next catch-up happen now. A full snapshot walk runs
 * on the first sync and daily after it, and that walk is also when the webhook
 * is (re)registered, so a key that may not register one is asked once a day.
 */
export class RepositorySyncService {
  constructor(private readonly container: AppContainer) {}

  /** Walk the snapshots and register the webhook now. A failure is recorded, not thrown. */
  async syncNow(): Promise<void> {
    const gateway = await this.gateway()
    if (gateway === null) return
    await this.run(gateway, 'reconcile').catch(() => undefined)
    await this.registerWebhook(gateway)
  }

  /** The clock's share: catch up every few minutes, walk the snapshots daily. Answers projects changed. */
  async tick(): Promise<number> {
    const gateway = await this.gateway()
    if (gateway === null) return 0
    const state = await this.state()
    const now = this.container.clock.now()
    if (state.reconciledAt === null || now - state.reconciledAt >= RECONCILE_EVERY_MS) {
      const changed = await this.run(gateway, 'reconcile')
      if (await this.webhookStale(state)) await this.registerWebhook(gateway)
      return changed
    }
    if (state.syncedAt !== null && now - state.syncedAt < CATCH_UP_EVERY_MS) return 0
    return this.run(gateway, 'catch-up')
  }

  /** Take a push. Null when the org has nothing a push could be verified against. */
  async receive(headers: Headers, rawBody: string): Promise<DirectoryDeliveryOutcome | null> {
    const [gateway, secret] = await Promise.all([
      this.gateway(),
      openCredential(this.container, repositorySyncSecretKey(CAT_FACTORY_SOURCE)),
    ])
    if (gateway === null || secret === null) return null
    const outcome = await gateway.receive(this.store(), { headers, rawBody, secret })
    if (outcome.ok) await this.settle(outcome.sync.reconciled)
    return outcome
  }

  /**
   * Stop following cat-factory: drop the webhook while the key still opens, and
   * the mirror with it. The projects stay, now the admins' to manage.
   */
  async forget(): Promise<void> {
    await this.removeWebhook((await this.state()).webhookUrl)
    const { repositories } = this.container
    await repositories.externalRepositories.clear(CAT_FACTORY_SOURCE)
    await repositories.integrationTokens.delete(repositorySyncSecretKey(CAT_FACTORY_SOURCE))
    await clearRepositorySyncState(this.container, CAT_FACTORY_SOURCE)
  }

  /** Best effort: an instance that is gone, or a key that may not, must not block forgetting it. */
  private async removeWebhook(url: string | null): Promise<void> {
    if (url === null) return
    try {
      const gateway = await this.gateway()
      if (gateway !== null) await gateway.removeWebhook(await this.webhookId(url))
    } catch (err) {
      this.container.logger.warn({ err }, 'could not remove the cat-factory directory webhook')
    }
  }

  /** Whether the push URL cat-factory holds is missing or no longer this deployment's address. */
  private async webhookStale(state: RepositorySyncState): Promise<boolean> {
    return state.webhook !== 'registered' || state.webhookUrl !== (await this.webhookUrl())
  }

  private async run(
    gateway: RepositoryDirectoryGateway,
    mode: 'reconcile' | 'catch-up',
  ): Promise<number> {
    try {
      const report = await (mode === 'reconcile'
        ? gateway.reconcile(this.store())
        : gateway.catchUp(this.store()))
      return await this.settle(report.reconciled)
    } catch (err) {
      await this.record({ error: getErrorMessage(err) })
      throw err
    }
  }

  /** Bring the projects to what the mirror now lists, and note when that happened. */
  private async settle(reconciled: boolean): Promise<number> {
    const { changed, warning } = await this.applyPlan()
    const now = this.container.clock.now()
    await this.record({
      syncedAt: now,
      error: warning,
      ...(reconciled ? { reconciledAt: now } : {}),
    })
    return changed
  }

  private async applyPlan(): Promise<{ changed: number; warning: string | null }> {
    const { projects, externalRepositories } = this.container.repositories
    const entries = await externalRepositories.list(CAT_FACTORY_SOURCE)
    const plan = planProjectSync(CAT_FACTORY_SOURCE, await projects.list(), entries)
    if (plan.remove.length > 0 && entries.length === 0) {
      return { changed: 0, warning: NOTHING_LISTED }
    }
    for (const projectId of plan.remove) await projects.delete(projectId)
    for (const { projectId, ...ref } of plan.rename) await projects.update(projectId, ref)
    for (const { projectId, external } of plan.adopt) await projects.update(projectId, { external })
    const service = new ProjectService(this.container)
    let created = 0
    for (const listed of plan.create) if ((await service.addListed(listed)) !== null) created += 1
    const renamed = new Set(plan.rename.map((step) => step.projectId)).size
    return { changed: plan.remove.length + renamed + plan.adopt.length + created, warning: null }
  }

  private async registerWebhook(gateway: RepositoryDirectoryGateway): Promise<void> {
    const url = await this.webhookUrl()
    if (url === null) {
      await this.record({
        webhook: 'failed',
        error: 'API_BASE_URL is not set, so there is no address cat-factory could push to',
      })
      return
    }
    const { webhookUrl: previous } = await this.state()
    try {
      const secret = await this.webhookSecret()
      await gateway.registerWebhook({ webhookId: await this.webhookId(url), url, secret })
      await this.record({ webhook: 'registered', webhookUrl: url })
    } catch (err) {
      await this.record({ webhook: 'failed', webhookUrl: url, error: getErrorMessage(err) })
      return
    }
    // The id follows the URL, so the one enrolled for a former address is a separate webhook.
    if (previous !== url) await this.removeWebhook(previous)
  }

  /** The stored push secret, or a new one sealed before cat-factory is told it. */
  private async webhookSecret(): Promise<string> {
    const key = repositorySyncSecretKey(CAT_FACTORY_SOURCE)
    const held = await openCredential(this.container, key)
    if (held !== null) return held
    const { secrets, repositories, clock } = this.container
    if (secrets === null) {
      throw new Error('SETTINGS_ENCRYPTION_KEY is not set, so no push secret can be stored')
    }
    const secret = base64url(crypto.getRandomValues(new Uint8Array(32)))
    await repositories.integrationTokens.put({
      integrationId: key,
      sealed: await secrets.encrypt(secret, key),
      hint: secret.slice(-4),
      subject: null,
      subjectIsBot: false,
      updatedAt: clock.now(),
    })
    return secret
  }

  private async webhookUrl(): Promise<string | null> {
    const base = this.container.apiBaseUrl
    if (base === null) return null
    const org = await new OrgService(this.container).current()
    return `${base.replace(/\/+$/, '')}${catFactoryWebhookPath(org.slug)}`
  }

  /**
   * One id per deployment and org, derived from the push URL: an account can be
   * shared by several deployments, and each must enrol its own endpoint.
   */
  private async webhookId(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `sainte-beuve-${hex.slice(0, 16)}`
  }

  private async gateway(): Promise<RepositoryDirectoryGateway | null> {
    const access = await repositoryDirectoryAccess(this.container)
    if (access === null || this.container.gateways === null) return null
    return this.container.gateways.catFactoryDirectory({
      baseUrl: access.config.baseUrl,
      apiKey: access.apiKey,
    })
  }

  private store(): RepositoryDirectoryStore {
    const { externalRepositories } = this.container.repositories
    return {
      getCursor: async () => (await this.state()).cursor,
      setCursor: async (seq) => {
        await this.record({ cursor: seq })
      },
      apply: (entry) => externalRepositories.apply({ ...entry, source: CAT_FACTORY_SOURCE }),
      liveKeys: async () =>
        (await externalRepositories.list(CAT_FACTORY_SOURCE))
          .filter((entry) => entry.repository !== null)
          .map((entry) => entry.key),
    }
  }

  private state(): Promise<RepositorySyncState> {
    return readRepositorySyncState(this.container, CAT_FACTORY_SOURCE)
  }

  private async record(patch: Partial<RepositorySyncState>): Promise<void> {
    await writeRepositorySyncState(this.container, CAT_FACTORY_SOURCE, patch)
  }
}
