import type {
  IntegrationConfigRepository,
  IntegrationTokenRepository,
  StoredIntegrationConfig,
  StoredIntegrationToken,
} from '@sainte-beuve/kernel'
import * as v from 'valibot'
import type { SqlDriver, SqlRow } from './driver.js'
import { decodeCount, decodeData, encodeData } from './rows.js'

/**
 * The sealed integration credentials.
 *
 * The one table with no payload column: the row is four flat fields, all of them
 * queried or shown, and wrapping them in JSON would hide the `hint` and the
 * `subject` the Configuration screen reads from anybody looking at the database.
 *
 * What is stored is an ENVELOPE. The plaintext never reaches a repository, so a
 * dump of this table carries no usable credential, and the durable store is no
 * more sensitive than the in-memory one it replaces.
 *
 * Scoped per ORG, like everything else: each tenancy connects its own GitHub and
 * its own Slack, and a credential shared across the boundary would let one org's
 * board write comments as another org's bot.
 */

const SELECT =
  'SELECT integration_id, sealed, hint, subject, updated_at FROM integration_tokens WHERE org_id = ?'

const UPSERT = `INSERT INTO integration_tokens (org_id, integration_id, sealed, hint, subject, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, integration_id) DO UPDATE SET
  sealed = excluded.sealed,
  hint = excluded.hint,
  subject = excluded.subject,
  updated_at = excluded.updated_at`

function toToken(row: SqlRow): StoredIntegrationToken {
  return {
    integrationId: String(row.integration_id),
    sealed: String(row.sealed),
    hint: String(row.hint),
    // Null for a credential somebody pasted, because a pasted token names
    // nobody. `?? null` rather than a cast: SQLite and Postgres agree on NULL
    // and disagree about nothing else here.
    subject: row.subject === null || row.subject === undefined ? null : String(row.subject),
    updatedAt: decodeCount(row.updated_at),
  }
}

export class SqlIntegrationTokenRepository implements IntegrationTokenRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(): Promise<StoredIntegrationToken[]> {
    const rows = await this.db.all(`${SELECT} ORDER BY integration_id`, [this.orgId])
    return rows.map(toToken)
  }

  async get(integrationId: string): Promise<StoredIntegrationToken | null> {
    const row = await this.db.first(`${SELECT} AND integration_id = ?`, [this.orgId, integrationId])
    return row === null ? null : toToken(row)
  }

  async put(token: StoredIntegrationToken): Promise<StoredIntegrationToken> {
    await this.db.run(UPSERT, [
      this.orgId,
      token.integrationId,
      token.sealed,
      token.hint,
      token.subject,
      token.updatedAt,
    ])
    return token
  }

  async delete(integrationId: string): Promise<void> {
    await this.db.run('DELETE FROM integration_tokens WHERE org_id = ? AND integration_id = ?', [
      this.orgId,
      integrationId,
    ])
  }
}

/**
 * The non-secret half of an integration, per org: a base URL, a service id.
 * The fields are one JSON object rather than columns, because each integration
 * has its own and none of them is queried.
 */
export class SqlIntegrationConfigRepository implements IntegrationConfigRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async get(integrationId: string): Promise<StoredIntegrationConfig | null> {
    const row = await this.db.first(
      'SELECT integration_id, data, updated_at FROM integration_configs WHERE org_id = ? AND integration_id = ?',
      [this.orgId, integrationId],
    )
    return row === null ? null : toConfig(row)
  }

  async put(config: StoredIntegrationConfig): Promise<StoredIntegrationConfig> {
    await this.db.run(
      `INSERT INTO integration_configs (org_id, integration_id, data, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (org_id, integration_id) DO UPDATE SET
  data = excluded.data,
  updated_at = excluded.updated_at`,
      [this.orgId, config.integrationId, encodeData(config.values), config.updatedAt],
    )
    return config
  }

  async delete(integrationId: string): Promise<void> {
    await this.db.run('DELETE FROM integration_configs WHERE org_id = ? AND integration_id = ?', [
      this.orgId,
      integrationId,
    ])
  }
}

const CONFIG_VALUES = v.record(v.string(), v.string())

function toConfig(row: SqlRow): StoredIntegrationConfig {
  return {
    integrationId: String(row.integration_id),
    values: decodeData(CONFIG_VALUES, 'integration_configs', row.data),
    updatedAt: decodeCount(row.updated_at),
  }
}
