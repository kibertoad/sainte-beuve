import type { ExternalDirectoryEntry, ExternalDirectoryKind } from '@sainte-beuve/contracts'
import { externalDirectoryEntrySchema } from '@sainte-beuve/contracts'
import type { ExternalDirectoryRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeRows, encodeData } from './rows.js'

const TABLE = 'external_directory'

export class SqlExternalDirectoryRepository implements ExternalDirectoryRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list<K extends ExternalDirectoryKind>(
    source: string,
    kind: K,
  ): Promise<Extract<ExternalDirectoryEntry, { kind: K }>[]> {
    const rows = await this.db.all(
      `SELECT data FROM ${TABLE} WHERE org_id = ? AND source = ? AND kind = ?`,
      [this.orgId, source, kind],
    )
    return decodeRows(externalDirectoryEntrySchema, TABLE, rows).filter(
      (entry): entry is Extract<ExternalDirectoryEntry, { kind: K }> => entry.kind === kind,
    )
  }

  async apply(entry: ExternalDirectoryEntry): Promise<void> {
    await this.db.run(
      `INSERT INTO ${TABLE} (org_id, source, kind, key, seq, data)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (org_id, source, kind, key) DO UPDATE SET
  seq = excluded.seq,
  data = excluded.data
WHERE excluded.seq >= ${TABLE}.seq`,
      [this.orgId, entry.source, entry.kind, entry.key, entry.seq, encodeData(entry)],
    )
  }

  async clear(source: string): Promise<void> {
    await this.db.run(`DELETE FROM ${TABLE} WHERE org_id = ? AND source = ?`, [this.orgId, source])
  }
}
