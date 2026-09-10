import type { Logger, PersistenceKind, Repositories } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import { connectPostgres, createPostgresRepositories } from '@sainte-beuve/persistence-postgres'
import type { NodeConfig } from './config.js'

/**
 * The store this process runs against, opened at boot.
 *
 * Postgres when `DATABASE_URL` is set, and the in-memory store when it is not.
 * The fallback is not a second product: it is what makes `pnpm dev:local` and a
 * first container run work before anybody has a database, and `/health` reports
 * which one is in force (`persistence: "memory"` is an alarm on a shared
 * deployment and the normal answer on a laptop).
 *
 * MIGRATIONS RUN HERE, before the server accepts a request. They are the
 * generated files that ship inside `@sainte-beuve/persistence-postgres`, they
 * are idempotent, and running them at boot is what keeps a rolling deploy from
 * serving requests against a schema one release behind. A deployment that would
 * rather gate them on a human runs them itself against
 * `POSTGRES_MIGRATIONS_DIR` and starts with `DATABASE_MIGRATE=false`.
 */
export interface NodeStore {
  repositories: Repositories
  kind: PersistenceKind
  close: () => Promise<void>
}

export async function openStore(config: NodeConfig, logger: Logger): Promise<NodeStore> {
  if (config.databaseUrl === null) {
    logger.warn(
      { persistence: 'memory' },
      'no DATABASE_URL: the board lives in memory and is lost on restart',
    )
    return { repositories: createInMemoryRepositories(), kind: 'memory', close: async () => {} }
  }

  const connection = connectPostgres({
    connectionString: config.databaseUrl,
    maxConnections: config.databaseMaxConnections,
  })
  if (config.databaseMigrate) {
    try {
      await connection.migrate()
    } catch (err: unknown) {
      // A boot that failed here must not leave the pool behind: an idle client
      // keeps the process alive, so a supervisor waiting for it to exit and
      // restart would wait for ever.
      await connection.close()
      throw err
    }
  }
  return {
    repositories: createPostgresRepositories(connection.db),
    kind: 'postgres',
    close: connection.close,
  }
}
