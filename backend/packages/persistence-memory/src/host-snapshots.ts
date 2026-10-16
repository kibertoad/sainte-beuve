import type { HostSnapshotRepository, StoredHostSnapshot } from '@sainte-beuve/kernel'
import { clone } from './clone.js'

/** One org's kept host reads, keyed by source and key. */
export class InMemoryHostSnapshotRepository implements HostSnapshotRepository {
  private readonly rows = new Map<string, StoredHostSnapshot>()

  async get(source: string, key: string): Promise<StoredHostSnapshot | null> {
    const row = this.rows.get(rowKey(source, key))
    return row === undefined ? null : clone(row)
  }

  async put(snapshot: StoredHostSnapshot): Promise<void> {
    this.rows.set(rowKey(snapshot.source, snapshot.key), clone(snapshot))
  }

  async delete(source: string, key: string): Promise<void> {
    this.rows.delete(rowKey(source, key))
  }
}

function rowKey(source: string, key: string): string {
  return JSON.stringify([source, key])
}
