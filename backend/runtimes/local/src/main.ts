// The library's own runnable entry for local mode. A deployment calls
// `startLocal()` itself; see deploy/local.
import { startLocal } from './index.js'

startLocal().catch((err: unknown) => {
  console.error('failed to start sainte-beuve in local mode:', err)
  process.exit(1)
})
