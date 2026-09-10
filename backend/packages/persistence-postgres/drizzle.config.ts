import { defineConfig } from 'drizzle-kit'

// How `pnpm db:generate` turns `src/schema.ts` into the SQL in `migrations/`.
//
// The generated files are COMMITTED and shipped inside the package: a
// deployment runs them through `PostgresConnection.migrate()` at boot, or points
// its own migration step at `POSTGRES_MIGRATIONS_DIR`. Nothing generates SQL at
// runtime, so what a deployment applies is what somebody read in a diff.
//
// No `dbCredentials` here on purpose: this config is only ever used to GENERATE.
// Anything that pushes a schema straight at a database (`drizzle-kit push`)
// would need a live URL, and a schema change that never became a migration file
// is one no other deployment can repeat.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
})
