import type { ExternalRepository } from '@sainte-beuve/contracts'
import type { ExternalRepositoryRepository } from '@sainte-beuve/kernel'
import { and, eq, lte } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr } from './rows.js'
import { externalRepositories } from './schema.js'

/** See `externalRepositories` in the schema. */
export class PostgresExternalRepositoryRepository implements ExternalRepositoryRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(source: string): Promise<ExternalRepository[]> {
    const rows = await this.db
      .select({ data: externalRepositories.data })
      .from(externalRepositories)
      .where(this.matching(source))
    return rows.map((row) => row.data)
  }

  async get(source: string, key: string): Promise<ExternalRepository | null> {
    const rows = await this.db
      .select({ data: externalRepositories.data })
      .from(externalRepositories)
      .where(and(this.matching(source), eq(externalRepositories.key, key)))
    return firstOr(rows)?.data ?? null
  }

  async apply(entry: ExternalRepository): Promise<void> {
    await this.db
      .insert(externalRepositories)
      .values({
        orgId: this.orgId,
        source: entry.source,
        key: entry.key,
        seq: entry.seq,
        data: entry,
      })
      .onConflictDoUpdate({
        target: [externalRepositories.orgId, externalRepositories.source, externalRepositories.key],
        set: { seq: entry.seq, data: entry },
        setWhere: lte(externalRepositories.seq, entry.seq),
      })
  }

  async clear(source: string): Promise<void> {
    await this.db.delete(externalRepositories).where(this.matching(source))
  }

  private matching(source: string) {
    return and(eq(externalRepositories.orgId, this.orgId), eq(externalRepositories.source, source))
  }
}
