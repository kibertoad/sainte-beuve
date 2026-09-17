// `@sainte-beuve/persistence-postgres`: the durable store the Node service
// boots with.
//
// Eleven stores over Drizzle and one org, against the same twelve tables the D1 adapter
// (@sainte-beuve/persistence-d1) carries, and the two land together because a
// capability durable on one runtime and not the other is the failure mode this
// layout exists to prevent.
//
// What keeps them one behaviour is `@sainte-beuve/persistence-conformance`: the
// same assertions run against this store, the D1 one, and the in-memory one.

export { createPostgresPersistence } from './provider.js'
export {
  connectPostgres,
  POSTGRES_MIGRATIONS_DIR,
  type PostgresConnection,
  type PostgresDatabase,
  type PostgresOptions,
} from './database.js'
export * as schema from './schema.js'
