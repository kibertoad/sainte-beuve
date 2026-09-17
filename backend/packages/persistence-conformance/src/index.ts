// `@sainte-beuve/persistence-conformance`: the suite every store has to pass.
//
// There are three implementations of the repository ports (in-memory, D1,
// Postgres over Drizzle) and one behaviour they are supposed to have. The
// difference between that being true and being hoped for is this package: the
// same cases run against all three, so an ordering the board depends on, a
// counter that has to accumulate, or a null that has to survive a round trip is
// asserted once and proved everywhere.
//
// A suite wires it up in three lines, because the cases are data:
//
//   for (const testCase of repositoryConformanceCases) {
//     it(testCase.name, async () => testCase.run(await freshStore()))
//   }
//
// `freshStore()` has to hand back EMPTY repositories: the cases write fixed ids
// and read whole lists back, so a case that inherited the previous one's rows
// would fail on the store that is fastest to set up and pass on the others.

import { apiKeyCases, sessionCases } from './auth-cases.js'
import { aiReviewCases, integrationTokenCases, reminderCases, reviewCases } from './board-cases.js'
import type { ConformanceCase } from './case.js'
import { reviewerCases } from './reviewer-cases.js'
import { attentionCases, commitmentCases, identityCases, projectCases } from './workspace-cases.js'

/** Every case, in the order the ports are declared on `Repositories`. */
export const repositoryConformanceCases: readonly ConformanceCase[] = [
  ...reviewerCases,
  ...reviewCases,
  ...reminderCases,
  ...aiReviewCases,
  ...integrationTokenCases,
  ...projectCases,
  ...identityCases,
  ...attentionCases,
  ...commitmentCases,
  ...sessionCases,
  ...apiKeyCases,
]

export type { ConformanceCase } from './case.js'
export { conformanceCase } from './case.js'
export {
  type StoredRowCase,
  storedRowConformanceCases,
  type StoreHarness,
} from './stored-row-cases.js'
export { apiKeyCases, sessionCases } from './auth-cases.js'
export { aiReviewCases, integrationTokenCases, reminderCases, reviewCases } from './board-cases.js'
export { reviewerCases } from './reviewer-cases.js'
export { attentionCases, commitmentCases, identityCases, projectCases } from './workspace-cases.js'
