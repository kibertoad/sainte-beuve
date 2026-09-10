// Node.js service deployment entry point.
//
// This is the example DEPLOYMENT of the reusable @sainte-beuve/node-server library.
// It contains no logic of its own: it calls the library's `start()`, which builds
// the container from the environment and serves the shared Hono app over
// @hono/node-server.
//
// Configuration comes from the process environment. The package scripts load a
// local `.env` through Node's NATIVE `--env-file-if-exists` flag (no dotenv
// dependency); in production, inject the same variables through your orchestrator.
//
// Node 24+ runs this TypeScript directly via built-in type stripping, so this entry
// needs no build step (the library itself ships compiled `dist`).
import { start } from '@sainte-beuve/node-server'

start().catch((err: unknown) => {
  console.error('failed to start the sainte-beuve node server:', err)
  process.exit(1)
})
