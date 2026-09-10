// Local-mode deployment entry point.
//
// This is the example DEPLOYMENT of @sainte-beuve/local-server: the whole product
// on your own machine, with no Slack workspace, no GitHub app and no cat-factory
// account required. It contains no logic of its own: it calls the library's
// `startLocal()`, which applies the local defaults and serves the shared Hono app.
//
// Node 24+ runs this TypeScript directly via built-in type stripping, so there is
// no build step for this entry.
import { startLocal } from '@sainte-beuve/local-server'

startLocal().catch((err: unknown) => {
  console.error('failed to start sainte-beuve in local mode:', err)
  process.exit(1)
})
