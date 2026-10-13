import type { ExternalDirectoryEntry, ExternalDirectoryKind } from '@sainte-beuve/contracts'

/**
 * The people, groups and memberships external systems list for this org, one
 * entry per `(source, kind, key)`. An entry the source dropped stays with a null
 * `record`, so its `seq` keeps refusing older states.
 */
export interface ExternalDirectoryRepository {
  /** Every entry of one kind from one source, dropped ones included, in no particular order. */
  list<K extends ExternalDirectoryKind>(
    source: string,
    kind: K,
  ): Promise<Extract<ExternalDirectoryEntry, { kind: K }>[]>
  /**
   * Store one entry unless the store holds a strictly newer `seq` for its key,
   * decided in one statement so two syncs racing on a key keep the newer state.
   */
  apply(entry: ExternalDirectoryEntry): Promise<void>
  /** Forget everything from one source, for an org that stopped syncing from it. */
  clear(source: string): Promise<void>
}
