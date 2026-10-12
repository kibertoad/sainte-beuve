import type { ExternalRepository } from '@sainte-beuve/contracts'
import { externalRepositorySchema } from '@sainte-beuve/contracts'
import type { ExternalRepositoryRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData } from './rows.js'

const TABLE = 'external_repositories'

export class SqlExternalRepositoryRepository implements ExternalRepositoryRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(source: string): Promise<ExternalRepository[]> {
    const rows = await this.db.all(`SELECT data FROM ${TABLE} WHERE org_id = ? AND source = ?`, [
      this.orgId,
      source,
    ])
    return decodeRows(externalRepositorySchema, TABLE, rows)
  }

  async get(source: string, key: string): Promise<ExternalRepository | null> {
    const row = await this.db.first(
      `SELECT data FROM ${TABLE} WHERE org_id = ? AND source = ? AND key = ?`,
      [this.orgId, source, key],
    )
    return row === null ? null : decodeData(externalRepositorySchema, TABLE, row.data)
  }

  async put(entry: ExternalRepository): Promise<void> {
    await this.db.run(
      `INSERT INTO ${TABLE} (org_id, source, key, seq, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (org_id, source, key) DO UPDATE SET
  seq = excluded.seq,
  data = excluded.data`,
      [this.orgId, entry.source, entry.key, entry.seq, encodeData(entry)],
    )
  }

  async clear(source: string): Promise<void> {
    await this.db.run(`DELETE FROM ${TABLE} WHERE org_id = ? AND source = ?`, [this.orgId, source])
  }
}
