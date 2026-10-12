import type { ExternalDirectoryEntry, ExternalDirectoryKind } from '@sainte-beuve/contracts'
import type { ExternalDirectoryRepository } from '@sainte-beuve/kernel'
import { and, eq, lte } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { externalDirectory } from './schema.js'

/** See `externalDirectory` in the schema. */
export class PostgresExternalDirectoryRepository implements ExternalDirectoryRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list<K extends ExternalDirectoryKind>(
    source: string,
    kind: K,
  ): Promise<Extract<ExternalDirectoryEntry, { kind: K }>[]> {
    const rows = await this.db
      .select({ data: externalDirectory.data })
      .from(externalDirectory)
      .where(and(this.matching(source), eq(externalDirectory.kind, kind)))
    return rows
      .map((row) => row.data)
      .filter((entry): entry is Extract<ExternalDirectoryEntry, { kind: K }> => {
        return entry.kind === kind
      })
  }

  async apply(entry: ExternalDirectoryEntry): Promise<void> {
    await this.db
      .insert(externalDirectory)
      .values({
        orgId: this.orgId,
        source: entry.source,
        kind: entry.kind,
        key: entry.key,
        seq: entry.seq,
        data: entry,
      })
      .onConflictDoUpdate({
        target: [
          externalDirectory.orgId,
          externalDirectory.source,
          externalDirectory.kind,
          externalDirectory.key,
        ],
        set: { seq: entry.seq, data: entry },
        setWhere: lte(externalDirectory.seq, entry.seq),
      })
  }

  async clear(source: string): Promise<void> {
    await this.db.delete(externalDirectory).where(this.matching(source))
  }

  private matching(source: string) {
    return and(eq(externalDirectory.orgId, this.orgId), eq(externalDirectory.source, source))
  }
}
