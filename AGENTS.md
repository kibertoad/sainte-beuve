# AGENTS.md

This repository's canonical agent guidance lives in **[`CLAUDE.md`](./CLAUDE.md)**:
the working rules (keep the runtimes symmetric, decisions pure and writes in
services, a route is its contract, size budgets) and the dependency pins that are
not preferences. **Read `CLAUDE.md` first.**

## Finding your way around

- **What exists and where**: the layout table in [`README.md`](./README.md#repository-layout).
- **Where it is going**: [`docs/implementation-plan.md`](./docs/implementation-plan.md),
  which also says which parts are placeholders and why they are still there.
- **How to run it**: `pnpm dev:local` plus `pnpm dev:frontend`. Nothing needs to be
  registered anywhere first.
