import type { Repositories } from '@sainte-beuve/kernel'

/**
 * One assertion about the repository ports, written once and run against every
 * store.
 *
 * Data rather than a `describe` block, and `node:assert` rather than a matcher
 * library, so this package depends on no test runner. The suites that consume it
 * do not all run in the same place: the in-memory and Postgres ones run in Node
 * and the D1 one runs inside workerd, and a shared module that reached for a
 * runner's globals would be the reason the D1 store ended up with a suite of its
 * own instead.
 */
export interface ConformanceCase {
  readonly name: string
  run(repositories: Repositories): Promise<void>
}

export function conformanceCase(
  name: string,
  run: (repositories: Repositories) => Promise<void>,
): ConformanceCase {
  return { name, run }
}
