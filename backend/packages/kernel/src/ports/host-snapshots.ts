import type { EpochMs } from '../domain/types.js'

/**
 * One read from a host, kept so the screens that need it again within a while
 * do not ask the host again. The payload is whatever the reader stored, and the
 * reader decodes it. It is a JSON object or array; the store checks nothing else.
 */
export interface StoredHostSnapshot {
  /** The host the read went to, e.g. `github`. */
  source: string
  /** What was read, in the reader's own spelling, e.g. `open-pulls:owner/repo`. */
  key: string
  data: unknown
  fetchedAt: EpochMs
}

/** One row per (source, key), replaced by every fresh read of it. */
export interface HostSnapshotRepository {
  get(source: string, key: string): Promise<StoredHostSnapshot | null>
  put(snapshot: StoredHostSnapshot): Promise<void>
  /** Forget one read, so the next one goes to the host. Absent is not an error. */
  delete(source: string, key: string): Promise<void>
}
