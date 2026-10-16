import { getErrorMessage } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'

/**
 * How long a kept host read is served before the host is asked again. A screen
 * may show a pull request opened in the last minute or two as missing; a host
 * that rate-limits the screens it backs is worse.
 */
export const SNAPSHOT_MAX_AGE = {
  openPullRequests: 2 * 60_000,
  search: 3 * 60_000,
  openReviews: 5 * 60_000,
  pullRequestStatus: 2 * 60_000,
  activity: 60 * 60_000,
} as const

export interface SnapshotRead<T> {
  source: string
  key: string
  maxAgeMs: number
  /** The kept payload, or null when it no longer fits (see `snapshotDecoder`). */
  decode: (value: unknown) => T | null
  fetch: () => Promise<T>
}

/** Reads of one snapshot in flight in this process, so a burst of screens asks the host once. */
const inFlight = new Map<string, Promise<unknown>>()

/**
 * A host read through the org's kept snapshot of it: the snapshot while it is
 * younger than `maxAgeMs`, else a fresh read that replaces it. When the fresh
 * read fails and a snapshot of any age is kept, the snapshot is served and the
 * failure logged, so a rate-limited host leaves the screens on older data
 * rather than on an error.
 */
export function readThroughSnapshot<T>(container: AppContainer, read: SnapshotRead<T>): Promise<T> {
  const flightKey = JSON.stringify([container.orgId, read.source, read.key])
  const running = inFlight.get(flightKey)
  if (running !== undefined) return running as Promise<T>
  const started = readSnapshot(container, read).finally(() => inFlight.delete(flightKey))
  inFlight.set(flightKey, started)
  return started
}

async function readSnapshot<T>(container: AppContainer, read: SnapshotRead<T>): Promise<T> {
  const kept = await keptSnapshot(container, read)
  const now = container.clock.now()
  if (kept !== null && now - kept.fetchedAt < read.maxAgeMs) return kept.data
  let fresh: T
  try {
    fresh = await read.fetch()
  } catch (err) {
    if (kept === null) throw err
    container.logger.warn(
      { err, source: read.source, key: read.key, fetchedAt: kept.fetchedAt },
      'the host could not be read, so an older snapshot of it is served',
    )
    return kept.data
  }
  await keep(container, read, { data: fresh, fetchedAt: now })
  return fresh
}

/** The kept snapshot if it still decodes; a store that cannot answer is a miss, not a failure. */
async function keptSnapshot<T>(
  container: AppContainer,
  read: SnapshotRead<T>,
): Promise<{ data: T; fetchedAt: number } | null> {
  try {
    const row = await container.repositories.hostSnapshots.get(read.source, read.key)
    if (row === null) return null
    const data = read.decode(row.data)
    return data === null ? null : { data, fetchedAt: row.fetchedAt }
  } catch (err) {
    container.logger.warn(
      { source: read.source, key: read.key, reason: getErrorMessage(err) },
      'a kept host snapshot could not be read',
    )
    return null
  }
}

async function keep<T>(
  container: AppContainer,
  read: SnapshotRead<T>,
  value: { data: T; fetchedAt: number },
): Promise<void> {
  try {
    await container.repositories.hostSnapshots.put({
      source: read.source,
      key: read.key,
      data: value.data,
      fetchedAt: value.fetchedAt,
    })
  } catch (err) {
    container.logger.warn(
      { source: read.source, key: read.key, reason: getErrorMessage(err) },
      'a host snapshot could not be kept',
    )
  }
}

/** The key a repository's open pull requests are kept under, also what a webhook forgets. */
export function openPullRequestsKey(repository: { owner: string; repo: string }): string {
  return `open-pulls:${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`
}
