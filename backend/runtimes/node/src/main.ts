// The library's own runnable entry, so `pnpm --filter @sainte-beuve/node-server
// start` works without a deployment package. A real deployment calls `start()`
// itself; see deploy/node.
import { start } from './index.js'

start().catch((err: unknown) => {
  console.error('failed to start the sainte-beuve node server:', err)
  process.exit(1)
})
