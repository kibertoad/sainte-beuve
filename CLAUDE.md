# CLAUDE.md

Working rules for this repo. Read [README.md](./README.md) for what exists and
[docs/implementation-plan.md](./docs/implementation-plan.md) for where it is going.

## Non-negotiables

- **Keep the runtimes symmetric.** A change to one facade (`backend/runtimes/*`)
  lands the equivalent change in the others in the same commit. A capability wired
  on the Worker and not on Node is the failure mode this layout exists to prevent.
- **Decisions are pure, writes are services.** New selection or scheduling logic
  goes in `@sainte-beuve/reviewers` / `@sainte-beuve/reminders` as a function over
  data. The service layer in `@sainte-beuve/server` owns ordering and persistence.
  If a decision needs a clock, a random source or an id, inject the port.
- **A route is its contract.** Add the contract in `@sainte-beuve/contracts` first,
  mount it with `buildHonoRoute`. Never hand-write a path in a controller, and never
  let the frontend reach a route the contracts do not describe.
- **Every integration stays optional.** A new gateway is nullable on the container,
  and the route that needs it calls `requireCapability` with a message naming the
  configuration that is missing.
- **The tenancy is bound, never passed.** No repository port method takes an org
  and no route accepts one: the authentication middleware reads it off the
  caller's credential and rebinds the container (`withOrg`), and every service
  below asks `container.repositories` as it always did. A new port method gets no
  `orgId` parameter, and anything that has to read across the boundary goes on
  `TenancyDirectory` — which is three methods and should stay that size. See
  [docs/orgs.md](./docs/orgs.md).
- **Three stores, one behaviour.** A change to a repository port lands in all
  three implementations (`persistence-memory`, `persistence-d1`,
  `persistence-postgres`) in the same commit, with a case in
  `@sainte-beuve/persistence-conformance`. Both durable stores carry the same
  tables; a new indexed column needs a migration in each dialect. See
  [docs/persistence.md](./docs/persistence.md).
- **Format and lint the whole tree**: `pnpm lint:fix`, never a file subset.
- **Add a changeset** for any change to a versioned package.
- Run `build` / `typecheck` / `test` through Turbo from the repo root. Test a
  targeted scope (`pnpm test:changed`, or one `--filter`), not the whole tree.

## Size budgets

oxlint enforces them: 400 lines per file, 60 lines per function, 4 parameters,
complexity 12, 25 statements, depth 4. Tests get their own, larger budget.

They are low on purpose. A fifth parameter becomes a named options object; a
sixty-first line becomes a second function. If a budget is genuinely wrong for a
case, raise it in `.oxlintrc.json` with the reason in the diff, not with an inline
disable.

## Adding a capability

1. Wire contract in `@sainte-beuve/contracts` (model, then route contract).
2. Port interface in `@sainte-beuve/kernel` if it reaches something external.
3. Pure logic in its own package, with a suite that needs no store.
4. Service in `@sainte-beuve/server`, mounted through a contract.
5. Adapter in `@sainte-beuve/integrations` (or a new package if it is a new system).
6. If it stores anything: the port method in all three stores, a case in
   `@sainte-beuve/persistence-conformance`, and a migration per dialect if it
   needs a column. A new table is keyed on `(org_id, …)`.
7. Wire it in ALL THREE runtime facades, nullable, reported on `/health`.
8. Changeset.

## Testing

- Pure packages test their logic directly. Inject `random`/`clock`/`ids` rather than
  freezing timers or matching a uuid with a regex.
- `@sainte-beuve/server` tests go through `app.fetch` against the in-memory store, so
  they cover the controller, the contract validation and the error envelope together.
- The store suites are one shared list of cases run three ways: in Node for the
  in-memory store, in Node against PGlite for Postgres, and inside workerd
  against a migrated D1. Assert store behaviour there, not in a service suite.
- The Worker suite runs inside workerd (`@cloudflare/vitest-pool-workers`) and stays
  a smoke suite: it proves the bundle boots on the runtime it deploys to, nothing
  else. Behaviour belongs in the server suite.

## Dependency pins that are not preferences

- **One wrangler, one workerd, one miniflare.** `@cloudflare/vitest-pool-workers`
  pins wrangler exactly; every package that declares wrangler matches that pin. Two
  copies mean the runtime the tests prove is a different build from the one that
  ships.
- **`@cloudflare/workers-types` is a workerd date.** Its version is derived from the
  workerd we run, and it is pinned in `pnpm-workspace.yaml` because optional-peer
  slots would otherwise float it. Move it with wrangler, never on its own.
- **Vitest stays on 4.x** while the Workers pool peers on `^4.1.0`. Move both
  together.
- **Drizzle is pinned exact, on a 1.0 release candidate.** `drizzle-orm` and
  `drizzle-kit` move together, because the generated migrations and the runtime
  that applies them come from one release. Regenerate with
  `pnpm --filter @sainte-beuve/persistence-postgres db:generate` after a bump and
  read the diff.
- **TypeScript 7 on the backend, 6 on the frontend.** Nuxt's toolchain (`vue-tsc`)
  does not run on 7 yet. Revisit when it does.
