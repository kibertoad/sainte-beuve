import type { ExternalRepository } from '@sainte-beuve/contracts'

/**
 * The repository lists external systems hold for this org, one entry per
 * `(source, key)`. An entry the source dropped stays with a null `repository`,
 * so its `seq` keeps refusing older states.
 */
export interface ExternalRepositoryRepository {
  /** Every entry from one source, dropped ones included, in no particular order. */
  list(source: string): Promise<ExternalRepository[]>
  get(source: string, key: string): Promise<ExternalRepository | null>
  /** Store or replace one entry. Whether it is newer is the caller's question. */
  put(entry: ExternalRepository): Promise<void>
  /** Forget everything from one source, for an org that stopped syncing from it. */
  clear(source: string): Promise<void>
}
