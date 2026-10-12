import type { ExternalDirectoryEntry, ExternalDirectoryKind } from '@sainte-beuve/contracts'
import type { ExternalDirectoryRepository } from '@sainte-beuve/kernel'
import { clone } from './clone.js'

/** One org's external directories, keyed by `(source, kind, key)`. */
export class InMemoryExternalDirectoryRepository implements ExternalDirectoryRepository {
  private readonly rows = new Map<string, ExternalDirectoryEntry>()

  async list<K extends ExternalDirectoryKind>(
    source: string,
    kind: K,
  ): Promise<Extract<ExternalDirectoryEntry, { kind: K }>[]> {
    return [...this.rows.values()]
      .filter((row): row is Extract<ExternalDirectoryEntry, { kind: K }> => {
        return row.source === source && row.kind === kind
      })
      .map(clone)
  }

  async apply(entry: ExternalDirectoryEntry): Promise<void> {
    const key = rowKey(entry.source, entry.kind, entry.key)
    const held = this.rows.get(key)
    if (held !== undefined && held.seq > entry.seq) return
    this.rows.set(key, clone(entry))
  }

  async clear(source: string): Promise<void> {
    for (const [key, row] of this.rows) if (row.source === source) this.rows.delete(key)
  }
}

function rowKey(source: string, kind: string, key: string): string {
  return JSON.stringify([source, kind, key])
}
