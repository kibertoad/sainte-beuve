import type {
  CatFactoryCheck,
  CatFactoryConfig,
  CatFactoryConnection,
  CheckCatFactory,
} from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import {
  clearCatFactoryConfig,
  originOf,
  readCatFactoryConfig,
  writeCatFactoryConfig,
} from '../../integrations/catFactoryConfig.js'
import { resolveCapabilities } from '../../integrations/capabilities.js'
import {
  readRepositorySyncState,
  repositorySyncOf,
} from '../../integrations/repositorySyncState.js'
import { catFactoryAccess, openCredential } from '../../integrations/resolve.js'
import { CAT_FACTORY_SOURCE, RepositorySyncService } from '../projects/RepositorySyncService.js'
import { type CheckedKey, catFactoryCheck } from './catFactoryCheck.js'

const NO_ADAPTERS = 'This deployment wired no gateway factory, so it cannot reach cat-factory'
const NOT_CONFIGURED =
  'Repositories follow cat-factory once this org has a cat-factory base URL and key; ' +
  'set both on the Configuration screen'

/**
 * This org's cat-factory connection: the settings it stored, whether a review
 * can be filed with them, and a check of a configuration against the instance
 * it names. The key is a credential and goes through the settings routes.
 */
export class CatFactoryConnectionService {
  constructor(private readonly container: AppContainer) {}

  async read(): Promise<CatFactoryConnection> {
    const [config, capabilities, sync] = await Promise.all([
      readCatFactoryConfig(this.container),
      resolveCapabilities(this.container),
      readRepositorySyncState(this.container, CAT_FACTORY_SOURCE),
    ])
    return {
      config,
      suggested: this.container.catFactorySuggestion,
      aiReviewReady: capabilities.aiReview,
      guidedReviewReady: capabilities.guidedReview,
      repositorySync: capabilities.repositoryDirectory ? repositorySyncOf(sync) : null,
    }
  }

  /**
   * A key is valid only on the instance that minted it, so a new base URL drops
   * the stored key rather than sending it there. Dropped first: a failed write
   * then leaves no key rather than a key bound to the wrong instance.
   */
  async save(config: CatFactoryConfig): Promise<CatFactoryConnection> {
    const stored = await readCatFactoryConfig(this.container)
    if (stored !== null && stored.baseUrl !== originOf(config.baseUrl)) {
      // Another instance is another directory: what was mirrored from the old one goes too.
      await new RepositorySyncService(this.container).forget()
      await this.dropKey()
    }
    await writeCatFactoryConfig(this.container, config)
    return this.read()
  }

  /** Bring the repositories in step with cat-factory now, and ask it to push from here on. */
  async syncRepositories(): Promise<CatFactoryConnection> {
    requireCapability(this.container.gateways, NO_ADAPTERS)
    requireCapability(await catFactoryAccess(this.container), NOT_CONFIGURED)
    await new RepositorySyncService(this.container).syncNow()
    return this.read()
  }

  /** The key goes with the settings, so a later save cannot bind it to another instance. */
  async clear(): Promise<CatFactoryConnection> {
    await new RepositorySyncService(this.container).forget()
    await this.dropKey()
    await clearCatFactoryConfig(this.container)
    return this.read()
  }

  /**
   * Try a configuration without storing it. A key entered with it wins, so a
   * replacement can be tried before it replaces anything. The stored key is
   * used only against the stored base URL: sent anywhere else it would be
   * readable by whoever answers there. With no base URL saved the key is bound
   * to nothing yet, and the first save binds it to whatever URL it names, so a
   * check against the URL typed in sends it nowhere a save could not.
   */
  async check(input: CheckCatFactory): Promise<CatFactoryCheck> {
    const { apiKey: entered, ...config } = input
    const { apiKey, key } =
      entered === undefined
        ? await this.storedKeyFor(config.baseUrl)
        : { apiKey: entered, key: 'entered' as const }
    if (apiKey === null) return catFactoryCheck(config, key, null)
    const factory = requireCapability(this.container.gateways, NO_ADAPTERS)
    const probe = factory.catFactoryProbe({ baseUrl: originOf(config.baseUrl), apiKey })
    return catFactoryCheck(config, key, await probe.probe())
  }

  /** Opened only when the key is bound to this URL or to none, so a check elsewhere holds no plaintext. */
  private async storedKeyFor(baseUrl: string): Promise<{ apiKey: string | null; key: CheckedKey }> {
    const stored = await readCatFactoryConfig(this.container)
    if (stored === null || stored.baseUrl === originOf(baseUrl)) {
      const apiKey = await openCredential(this.container, 'cat-factory')
      return { apiKey, key: apiKey === null ? null : 'stored' }
    }
    const held = await this.container.repositories.integrationTokens.get('cat-factory')
    return { apiKey: null, key: held === null ? null : 'elsewhere' }
  }

  private async dropKey(): Promise<void> {
    await this.container.repositories.integrationTokens.delete('cat-factory')
  }
}
