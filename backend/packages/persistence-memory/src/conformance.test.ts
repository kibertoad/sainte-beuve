import { repositoryConformanceCases } from '@sainte-beuve/persistence-conformance'
import { describe, it } from 'vitest'
import { createInMemoryRepositories } from './stores.js'

// The shared suite (@sainte-beuve/persistence-conformance), run against the
// in-memory store. The same cases run against D1 and against Postgres.
//
// This store is the one the ports were written against, so it is also the one
// most likely to be right by construction; what the suite is for here is the
// other direction. A case added because a durable adapter got something wrong
// has to hold for this store too, or local mode and the hosted deployments
// would behave differently and only the durable ones would be tested for it.
describe('in-memory repositories', () => {
  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      await testCase.run(createInMemoryRepositories())
    })
  }
})
