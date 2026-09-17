import type { Org } from '@sainte-beuve/contracts'
import type { OrgRepository } from '@sainte-beuve/kernel'
import { asc, eq } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { orgs } from './schema.js'

/**
 * The tenancies, in Postgres.
 *
 * The one table in this package with no `org_id`, because it is the table that
 * says which orgs there are. It has no delete for the reason the port gives: an
 * org owns rows in all eleven other tables, and removing one is a cascade
 * nobody has specified.
 */
export class PostgresOrgRepository implements OrgRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(): Promise<Org[]> {
    const rows = await this.db.select().from(orgs).orderBy(asc(orgs.createdAt), asc(orgs.id))
    return rows.map((row) => row.data)
  }

  async getById(orgId: string): Promise<Org | null> {
    const rows = await this.db.select().from(orgs).where(eq(orgs.id, orgId))
    return firstOr(rows)?.data ?? null
  }

  async getBySlug(slug: string): Promise<Org | null> {
    const rows = await this.db.select().from(orgs).where(eq(orgs.slug, slug))
    return firstOr(rows)?.data ?? null
  }

  /**
   * `DO NOTHING` rather than an update, because the slug is a CLAIM: the first
   * writer owns it, and a second caller needs to be told which row won rather
   * than quietly renaming somebody else's tenancy. An insert that did nothing
   * returns no row, and the holder is read instead.
   */
  async create(org: Org): Promise<Org> {
    const inserted = await this.db
      .insert(orgs)
      .values({ id: org.id, slug: org.slug, createdAt: org.createdAt, data: org })
      .onConflictDoNothing()
      .returning({ data: orgs.data })
    const won = firstOr(inserted)
    if (won !== null) return won.data
    // Lost the claim, on either key. The holder of the SLUG is the answer when
    // there is one: an id collision means the same org, and a slug collision
    // means a different one already has the name.
    return (await this.getBySlug(org.slug)) ?? (await this.getById(org.id)) ?? org
  }

  async update(orgId: string, patch: Partial<Org>): Promise<Org | null> {
    const current = await this.getById(orgId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.db.update(orgs).set({ slug: next.slug, data: next }).where(eq(orgs.id, orgId))
    return next
  }
}
