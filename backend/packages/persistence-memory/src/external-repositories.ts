import type { ExternalRepository } from '@sainte-beuve/contracts'
import type { ExternalRepositoryRepository } from '@sainte-beuve/kernel'
import { clone } from './clone.js'

/** One org's external repository lists, keyed by `(source, key)`. */
export class InMemoryExternalRepositoryRepository implements ExternalRepositoryRepository {
  private readonly rows = new Map<string, ExternalRepository>()

  async list(source: string): Promise<ExternalRepository[]> {
    return [...this.rows.values()].filter((row) => row.source === source).map(clone)
  }

  async get(source: string, key: string): Promise<ExternalRepository | null> {
    const row = this.rows.get(rowKey(source, key))
    return row === undefined ? null : clone(row)
  }

  async put(entry: ExternalRepository): Promise<void> {
    this.rows.set(rowKey(entry.source, entry.key), clone(entry))
  }

  async clear(source: string): Promise<void> {
    for (const [key, row] of this.rows) if (row.source === source) this.rows.delete(key)
  }
}

function rowKey(source: string, key: string): string {
  return JSON.stringify([source, key])
}
