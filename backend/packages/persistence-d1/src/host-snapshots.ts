import type { HostSnapshotRepository, StoredHostSnapshot } from '@sainte-beuve/kernel'
import * as v from 'valibot'
import type { SqlDriver } from './driver.js'
import { decodeCount, decodeData, encodeData } from './rows.js'

const TABLE = 'host_snapshots'

/** The reader decodes the payload against its own schema, so the store accepts any JSON. */
const ANY_PAYLOAD = v.unknown()

const UPSERT = `INSERT INTO ${TABLE} (org_id, source, key, fetched_at, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (org_id, source, key) DO UPDATE SET
  fetched_at = excluded.fetched_at,
  data = excluded.data`

export class SqlHostSnapshotRepository implements HostSnapshotRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async get(source: string, key: string): Promise<StoredHostSnapshot | null> {
    const row = await this.db.first(
      `SELECT fetched_at, data FROM ${TABLE} WHERE org_id = ? AND source = ? AND key = ?`,
      [this.orgId, source, key],
    )
    if (row === null) return null
    return {
      source,
      key,
      data: decodeData(ANY_PAYLOAD, TABLE, row.data),
      fetchedAt: decodeCount(row.fetched_at),
    }
  }

  async put(snapshot: StoredHostSnapshot): Promise<void> {
    await this.db.run(UPSERT, [
      this.orgId,
      snapshot.source,
      snapshot.key,
      snapshot.fetchedAt,
      encodeData(snapshot.data),
    ])
  }

  async delete(source: string, key: string): Promise<void> {
    await this.db.run(`DELETE FROM ${TABLE} WHERE org_id = ? AND source = ? AND key = ?`, [
      this.orgId,
      source,
      key,
    ])
  }
}
