import type { IntegrationTokenRepository, StoredIntegrationToken } from '@sainte-beuve/kernel'
import { asc, eq } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { integrationTokens } from './schema.js'

/**
 * The sealed integration credentials.
 *
 * The row IS the columns here, with no payload: four flat fields, all of them
 * read, and wrapping them in JSON would hide the hint and the subject the
 * Configuration screen shows from anybody looking at the database.
 */
export class PostgresIntegrationTokenRepository implements IntegrationTokenRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(): Promise<StoredIntegrationToken[]> {
    return this.db.select().from(integrationTokens).orderBy(asc(integrationTokens.integrationId))
  }

  async get(integrationId: string): Promise<StoredIntegrationToken | null> {
    const rows = await this.db
      .select()
      .from(integrationTokens)
      .where(eq(integrationTokens.integrationId, integrationId))
    return firstOr(rows)
  }

  async put(token: StoredIntegrationToken): Promise<StoredIntegrationToken> {
    await this.db
      .insert(integrationTokens)
      .values(token)
      .onConflictDoUpdate({ target: integrationTokens.integrationId, set: token })
    return token
  }

  async delete(integrationId: string): Promise<void> {
    await this.db
      .delete(integrationTokens)
      .where(eq(integrationTokens.integrationId, integrationId))
  }
}
