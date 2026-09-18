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
//
// There are two lists. `repositoryConformanceCases` is written against one org's
// `Repositories` and is what every behaviour is asserted through;
// `tenancyConformanceCases` takes the whole `PersistenceProvider`, because what
// it is about is the seam between two orgs and a store bound to one has no
// method that reaches outside it. Both run three ways.

import { apiKeyCases, sessionCases } from './auth-cases.js'
import { aiReviewCases, integrationTokenCases, reviewCases } from './board-cases.js'
import { reminderCases } from './reminder-cases.js'
import type { ConformanceCase } from './case.js'
import { reviewerCases } from './reviewer-cases.js'
import { type TenancyCase, tenancyConformanceCases as boundaryCases } from './tenancy-cases.js'
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
]

/**
 * The cases that need the whole provider: the boundary between two orgs, and the
 * two credential tables, whose one interesting read is the digest lookup that
 * DECIDES which org a request is in.
 */
export const tenancyConformanceCases: readonly TenancyCase[] = [
  ...boundaryCases,
  ...sessionCases,
  ...apiKeyCases,
]

export type { ConformanceCase } from './case.js'
export { conformanceCase } from './case.js'
export { type TenancyCase, tenancyCase } from './tenancy-cases.js'
export {
  type StoredRowCase,
  storedRowConformanceCases,
  type StoreHarness,
} from './stored-row-cases.js'
export { apiKeyCases, sessionCases } from './auth-cases.js'
export { aiReviewCases, integrationTokenCases, reviewCases } from './board-cases.js'
export { reminderCases } from './reminder-cases.js'
export { reviewerCases } from './reviewer-cases.js'
export { attentionCases, commitmentCases, identityCases, projectCases } from './workspace-cases.js'
