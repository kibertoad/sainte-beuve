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
import { openCredential } from '../../integrations/resolve.js'
import { type CheckedKey, catFactoryCheck } from './catFactoryCheck.js'

const NO_ADAPTERS = 'This deployment wired no gateway factory, so it cannot reach cat-factory'

/**
 * This org's cat-factory connection: the settings it stored, whether a review
 * can be filed with them, and a check of a configuration against the instance
 * it names. The key is a credential and goes through the settings routes.
 */
export class CatFactoryConnectionService {
  constructor(private readonly container: AppContainer) {}

  async read(): Promise<CatFactoryConnection> {
    const [config, capabilities] = await Promise.all([
      readCatFactoryConfig(this.container),
      resolveCapabilities(this.container),
    ])
    return {
      config,
      suggested: this.container.catFactorySuggestion,
      aiReviewReady: capabilities.aiReview,
      guidedReviewReady: capabilities.guidedReview,
    }
  }

  /**
   * A key is valid only on the instance that minted it, so a new base URL drops
   * the stored key rather than sending it there. Dropped first: a failed write
   * then leaves no key rather than a key bound to the wrong instance.
   */
  async save(config: CatFactoryConfig): Promise<CatFactoryConnection> {
    const stored = await readCatFactoryConfig(this.container)
    if (stored !== null && stored.baseUrl !== originOf(config.baseUrl)) await this.dropKey()
    await writeCatFactoryConfig(this.container, config)
    return this.read()
  }

  /** The key goes with the settings, so a later save cannot bind it to another instance. */
  async clear(): Promise<CatFactoryConnection> {
    await this.dropKey()
    await clearCatFactoryConfig(this.container)
    return this.read()
  }

  /**
   * Try a configuration without storing it. A key entered with it wins, so a
   * replacement can be tried before it replaces anything. The stored key is
   * used only against the stored base URL: sent anywhere else it would be
   * readable by whoever answers there.
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

  /** Opened only when the URL is the stored one, so a check elsewhere holds no plaintext. */
  private async storedKeyFor(baseUrl: string): Promise<{ apiKey: string | null; key: CheckedKey }> {
    const stored = await readCatFactoryConfig(this.container)
    if (stored?.baseUrl === originOf(baseUrl)) {
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
