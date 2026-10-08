import type { IntegrationConfigRepository, StoredIntegrationConfig } from '@sainte-beuve/kernel'
import { clone } from './clone.js'

/** Per-org integration settings, beside the sealed tokens in `stores.ts`. */
export class InMemoryIntegrationConfigRepository implements IntegrationConfigRepository {
  private readonly rows = new Map<string, StoredIntegrationConfig>()

  async get(integrationId: string): Promise<StoredIntegrationConfig | null> {
    const row = this.rows.get(integrationId)
    return row === undefined ? null : clone(row)
  }

  async put(config: StoredIntegrationConfig): Promise<StoredIntegrationConfig> {
    this.rows.set(config.integrationId, clone(config))
    return clone(config)
  }

  async delete(integrationId: string): Promise<void> {
    this.rows.delete(integrationId)
  }
}
