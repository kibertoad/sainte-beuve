import type { EpochMs } from '../domain/types.js'

/**
 * One integration's NON-SECRET settings for an org: where an instance lives,
 * which service it files under. Stored in the clear, beside the sealed
 * credential rather than inside it, so a screen can show them back without
 * opening a credential.
 */
export interface StoredIntegrationConfig {
  integrationId: string
  /** Flat string fields. A field that is not set is absent rather than empty. */
  values: Record<string, string>
  updatedAt: EpochMs
}

/** One row per integration that has settings. Keyed by integration id, like the tokens. */
export interface IntegrationConfigRepository {
  get(integrationId: string): Promise<StoredIntegrationConfig | null>
  /** Store or replace the settings for one integration. */
  put(config: StoredIntegrationConfig): Promise<StoredIntegrationConfig>
  delete(integrationId: string): Promise<void>
}
