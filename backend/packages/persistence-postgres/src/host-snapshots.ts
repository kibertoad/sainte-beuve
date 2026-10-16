import type { HostSnapshotRepository, StoredHostSnapshot } from '@sainte-beuve/kernel'
import { and, eq } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { hostSnapshots } from './snapshot-schema.js'

export class PostgresHostSnapshotRepository implements HostSnapshotRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async get(source: string, key: string): Promise<StoredHostSnapshot | null> {
    const rows = await this.db
      .select({
        source: hostSnapshots.source,
        key: hostSnapshots.key,
        data: hostSnapshots.data,
        fetchedAt: hostSnapshots.fetchedAt,
      })
      .from(hostSnapshots)
      .where(this.matching(source, key))
    return firstOr(rows)
  }

  async put(snapshot: StoredHostSnapshot): Promise<void> {
    const row = { fetchedAt: snapshot.fetchedAt, data: snapshot.data }
    await this.db
      .insert(hostSnapshots)
      .values({ ...row, orgId: this.orgId, source: snapshot.source, key: snapshot.key })
      .onConflictDoUpdate({
        target: [hostSnapshots.orgId, hostSnapshots.source, hostSnapshots.key],
        set: row,
      })
  }

  async delete(source: string, key: string): Promise<void> {
    await this.db.delete(hostSnapshots).where(this.matching(source, key))
  }

  private matching(source: string, key: string) {
    return and(
      eq(hostSnapshots.orgId, this.orgId),
      eq(hostSnapshots.source, source),
      eq(hostSnapshots.key, key),
    )
  }
}
