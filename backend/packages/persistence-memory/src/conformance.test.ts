import {
  repositoryConformanceCases,
  tenancyConformanceCases,
} from '@sainte-beuve/persistence-conformance'
import { DEFAULT_ORG_ID } from '@sainte-beuve/contracts'
import { describe, it } from 'vitest'
import { createInMemoryPersistence } from './provider.js'

// The shared suite (@sainte-beuve/persistence-conformance), run against the
// in-memory store. The same cases run against D1 and against Postgres.
//
// This store is the one the ports were written against, so it is also the one
// most likely to be right by construction; what the suite is for here is the
// other direction. A case added because a durable adapter got something wrong
// has to hold for this store too, or local mode and the hosted deployments
// would behave differently and only the durable ones would be tested for it.
//
// The tenancy cases matter MORE here than anywhere, not less. This adapter
// reaches isolation structurally (a dataset per org) where the durable ones
// filter on a column, so it is the implementation that could not fail them; a
// case it passes for free is still what says the two arrangements mean the same.
describe('in-memory repositories', () => {
  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createInMemoryPersistence().forOrg(DEFAULT_ORG_ID))
    })
  }

  for (const testCase of tenancyConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createInMemoryPersistence())
    })
  }
})
