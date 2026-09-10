import type { SqlDriver, SqlParam, SqlRow } from './driver.js'

/**
 * The D1 half of this adapter: three methods over `D1Database`.
 *
 * Everything above it is plain SQL with `?` placeholders, which is D1's own
 * binding syntax, so there is nothing to translate. What the class is actually
 * for is keeping `prepare/bind/all` out of nine stores, and keeping the one
 * D1-specific rule in one place: `bind()` with no arguments is not the same as
 * not binding, so a statement with no parameters is prepared and run as it is.
 */
export class D1SqlDriver implements SqlDriver {
  constructor(private readonly db: D1Database) {}

  async all(sql: string, params: readonly SqlParam[] = []): Promise<SqlRow[]> {
    const result = await this.statement(sql, params).all()
    return result.results as SqlRow[]
  }

  async first(sql: string, params: readonly SqlParam[] = []): Promise<SqlRow | null> {
    return (await this.statement(sql, params).first()) as SqlRow | null
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    await this.statement(sql, params).run()
  }

  private statement(sql: string, params: readonly SqlParam[]): D1PreparedStatement {
    const prepared = this.db.prepare(sql)
    return params.length === 0 ? prepared : prepared.bind(...params)
  }
}
