import type { AttentionRequest } from '@sainte-beuve/contracts'

/**
 * Which version of each request this page has already applied.
 *
 * Two events about one request arrive INDEPENDENTLY once the fan-out is a
 * network hop. On the Worker a publish is one unawaited fetch to the org's hub
 * per event, so `committed` and the `resolved` that followed it race, and there
 * is no ordering anywhere between the two. The stream carries the whole row
 * rather than a delta, so whichever lands second is what the board shows — and
 * a `resolved` overtaken by the `committed` before it puts an answered ask back
 * on everybody's board with nothing left to correct it. There is no next event
 * for that request, and it will not be in the next fetch either, because the
 * server does not think it is open.
 *
 * `updatedAt` is what orders them: the store's own stamp on the write each event
 * announces, so it is the publisher's order rather than the network's. Comparing
 * a row against the newest stamp seen for its id is the whole of the rule.
 *
 * Pure and auto-imported, like the board's clock beside it, so the rule has a
 * suite rather than being checked by watching two people answer one ask.
 */
export interface AttentionLedger {
  /** Whether this row is OLDER than what has already been applied for its id. */
  isStale(request: AttentionRequest): boolean
  /** Record a row as applied. Keeps the newest; a stale one is ignored. */
  remember(request: AttentionRequest): void
}

/**
 * How many ids the ledger holds.
 *
 * It has to remember requests that have LEFT the list — a resolved ask is
 * exactly the one a late event would resurrect — so it cannot be pruned against
 * what is on screen, and a page left open for a week would otherwise hold every
 * ask the org ever raised. The window an event can be reordered within is the
 * gap between two fetches to one hub, seconds at the outside, so an entry is
 * useless to anybody long before it is dropped.
 */
const REMEMBERED = 500

interface Seen {
  at: number
  open: boolean
}

export function createAttentionLedger(): AttentionLedger {
  const seen = new Map<string, Seen>()

  const isStale = (request: AttentionRequest): boolean => {
    const last = seen.get(request.id)
    if (last === undefined) return false
    if (request.updatedAt !== last.at) return request.updatedAt < last.at
    // The same stamp twice is usually the same write twice, which happens by
    // design: an event that raced a refetch is applied again on top of it, and
    // dropping the second copy would leave the fetch's older list standing. The
    // exception is the one that matters — two writes CAN land in the same
    // millisecond, and of the two orders only one is allowed to be wrong, so an
    // ask already seen closed is never reopened by a row of the same age.
    return request.status === 'open' && !last.open
  }

  return {
    isStale,
    remember: (request) => {
      if (isStale(request)) return
      // Deleted before it is set, so the map's own order is recency and the
      // entry that goes when it is full is the one nothing has mentioned for
      // longest.
      seen.delete(request.id)
      seen.set(request.id, { at: request.updatedAt, open: request.status === 'open' })
      if (seen.size <= REMEMBERED) return
      const oldest = seen.keys().next()
      if (!oldest.done) seen.delete(oldest.value)
    },
  }
}
