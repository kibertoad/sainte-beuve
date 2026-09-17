/**
 * The orders the durable stores spell in SQL, as comparators.
 *
 * Both of them sort on a timestamp AND on the id (`ORDER BY created_at DESC, id
 * DESC`), and the second term is the load-bearing one: two rows written in the
 * same millisecond otherwise come back in whichever order the store happened to
 * be filled in, so the board would be ordered one way on a laptop and another
 * way on a hosted deployment. Reviewer selection reads its candidates
 * positionally, so that difference reaches as far as which person a given
 * random draw picks.
 *
 * `@sainte-beuve/persistence-conformance` is what holds the three stores to
 * these, including the ties.
 */

interface Keyed {
  id: string
}

/** `ORDER BY <timestamp>, id`. */
export function oldestFirst<Row extends Keyed>(
  timestamp: (row: Row) => number,
): (a: Row, b: Row) => number {
  return (a, b) => timestamp(a) - timestamp(b) || byText(a.id, b.id)
}

/** `ORDER BY <timestamp> DESC, id DESC`. */
export function newestFirst<Row extends Keyed>(
  timestamp: (row: Row) => number,
): (a: Row, b: Row) => number {
  return (a, b) => timestamp(b) - timestamp(a) || byText(b.id, a.id)
}

/**
 * `ORDER BY <last polled> ASC NULLS FIRST, <requested>, id`: the rotation the
 * clock's in-flight read walks.
 *
 * A run nobody has polled yet has no timestamp to compare, and it is the one that
 * most needs polling, so a null sorts before every real reading. Both durable
 * stores spell that explicitly — Postgres would otherwise put nulls LAST — and
 * this is the comparator that has to agree with them.
 */
export function leastRecentlyPolledFirst<Row extends Keyed>(
  polled: (row: Row) => number | null,
  requested: (row: Row) => number,
): (a: Row, b: Row) => number {
  return (a, b) =>
    nullsFirst(polled(a), polled(b)) || requested(a) - requested(b) || byText(a.id, b.id)
}

function nullsFirst(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : -1
  return b === null ? 1 : a - b
}

/**
 * Code-point order, which is what SQLite and Postgres both compare `TEXT` in.
 * Not `localeCompare`, which reorders punctuation and case by locale and would
 * put a reviewer id like `r-1` on either side of `r1` depending on where the
 * process runs.
 */
export function byText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
