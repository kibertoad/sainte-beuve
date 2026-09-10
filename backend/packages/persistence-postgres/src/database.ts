import { fileURLToPath } from 'node:url'
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/**
 * The connection, and the migrations that have to have run against it.
 *
 * The stores are typed against Drizzle's BASE database type rather than the
 * node-postgres one, so the suite can run every case against PGlite (Postgres
 * compiled to WASM, no container, no service in CI) and prove the same code.
 * Nothing in the stores reaches for a driver-specific method, which is what
 * makes that honest rather than a shortcut.
 */
export type PostgresDatabase = PgAsyncDatabase<PgQueryResultHKT>

/**
 * Where the generated migrations live, for a deployment that would rather run
 * them as a step of its own than at boot.
 *
 * Resolved from this module rather than from the working directory: the
 * migrations ship inside the package (`files` in package.json), and a relative
 * path would depend on where the process happened to be started.
 */
export const POSTGRES_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export interface PostgresConnection {
  db: PostgresDatabase
  /**
   * Bring the schema up to date. Idempotent, and safe to call on every boot:
   * Drizzle records what it has applied in `drizzle.__drizzle_migrations`.
   */
  migrate(): Promise<void>
  close(): Promise<void>
}

export interface PostgresOptions {
  connectionString: string
  /** Pool ceiling. Left to node-postgres (10) when unset. */
  maxConnections?: number
}

/** One pool, one Drizzle instance, and the two lifecycle calls a facade needs. */
export function connectPostgres(options: PostgresOptions): PostgresConnection {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
  })
  const db = drizzle({ client: pool })
  return {
    db,
    migrate: async () => {
      await migrate(db, { migrationsFolder: POSTGRES_MIGRATIONS_DIR })
    },
    close: async () => {
      await pool.end()
    },
  }
}
