import type {
  IntegrationConfigRepository,
  IntegrationTokenRepository,
  StoredIntegrationConfig,
  StoredIntegrationToken,
} from '@sainte-beuve/kernel'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { integrationConfigs, integrationTokens } from './schema.js'

/**
 * The sealed integration credentials.
 *
 * The row IS the columns here, with no payload: four flat fields, all of them
 * read, and wrapping them in JSON would hide the hint and the subject the
 * Configuration screen shows from anybody looking at the database.
 */
/**
 * The port's shape, which is the row WITHOUT its tenancy: the org is what the
 * store is bound to, not something a caller asked for, and a `select()` that
 * spread the whole row would put an `orgId` on a `StoredIntegrationToken` for
 * nobody to read.
 */
const TOKEN_COLUMNS = {
  integrationId: integrationTokens.integrationId,
  sealed: integrationTokens.sealed,
  hint: integrationTokens.hint,
  subject: integrationTokens.subject,
  updatedAt: integrationTokens.updatedAt,
}

export class PostgresIntegrationTokenRepository implements IntegrationTokenRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(): Promise<StoredIntegrationToken[]> {
    return this.db
      .select(TOKEN_COLUMNS)
      .from(integrationTokens)
      .where(eq(integrationTokens.orgId, this.orgId))
      .orderBy(asc(integrationTokens.integrationId))
  }

  async get(integrationId: string): Promise<StoredIntegrationToken | null> {
    const rows = await this.db
      .select(TOKEN_COLUMNS)
      .from(integrationTokens)
      .where(
        and(
          eq(integrationTokens.orgId, this.orgId),
          eq(integrationTokens.integrationId, integrationId),
        ),
      )
    return firstOr(rows)
  }

  async put(token: StoredIntegrationToken): Promise<StoredIntegrationToken> {
    await this.db
      .insert(integrationTokens)
      .values({ ...token, orgId: this.orgId })
      .onConflictDoUpdate({
        target: [integrationTokens.orgId, integrationTokens.integrationId],
        set: token,
      })
    return token
  }

  async delete(integrationId: string): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(
        and(
          eq(integrationTokens.orgId, this.orgId),
          eq(integrationTokens.integrationId, integrationId),
        ),
      )
  }
}

/** The non-secret half of an integration, per org. See `integrationConfigs` in the schema. */
export class PostgresIntegrationConfigRepository implements IntegrationConfigRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async get(integrationId: string): Promise<StoredIntegrationConfig | null> {
    const rows = await this.db
      .select({
        integrationId: integrationConfigs.integrationId,
        values: integrationConfigs.data,
        updatedAt: integrationConfigs.updatedAt,
      })
      .from(integrationConfigs)
      .where(this.matching(integrationId))
    return firstOr(rows)
  }

  async put(config: StoredIntegrationConfig): Promise<StoredIntegrationConfig> {
    const row = { data: config.values, updatedAt: config.updatedAt }
    await this.db
      .insert(integrationConfigs)
      .values({ ...row, orgId: this.orgId, integrationId: config.integrationId })
      .onConflictDoUpdate({
        target: [integrationConfigs.orgId, integrationConfigs.integrationId],
        set: row,
      })
    return config
  }

  async delete(integrationId: string): Promise<void> {
    await this.db.delete(integrationConfigs).where(this.matching(integrationId))
  }

  private matching(integrationId: string) {
    return and(
      eq(integrationConfigs.orgId, this.orgId),
      eq(integrationConfigs.integrationId, integrationId),
    )
  }
}
