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
import { catFactoryCheck } from './catFactoryCheck.js'

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

  async save(config: CatFactoryConfig): Promise<CatFactoryConnection> {
    await writeCatFactoryConfig(this.container, config)
    return this.read()
  }

  async clear(): Promise<CatFactoryConnection> {
    await clearCatFactoryConfig(this.container)
    return this.read()
  }

  /**
   * Try a configuration without storing it. The key entered with it wins over
   * the stored one, so a replacement can be tried before it replaces anything.
   */
  async check(input: CheckCatFactory): Promise<CatFactoryCheck> {
    const { apiKey: entered, ...config } = input
    const apiKey = entered ?? (await openCredential(this.container, 'cat-factory'))
    if (apiKey === null) return catFactoryCheck(config, null, null)
    const factory = requireCapability(this.container.gateways, NO_ADAPTERS)
    const probe = factory.catFactoryProbe({ baseUrl: originOf(config.baseUrl), apiKey })
    return catFactoryCheck(
      config,
      entered === undefined ? 'stored' : 'entered',
      await probe.probe(),
    )
  }
}
