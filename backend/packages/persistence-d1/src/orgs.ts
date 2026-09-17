import type { Org } from '@sainte-beuve/contracts'
import { orgSchema } from '@sainte-beuve/contracts'
import type { OrgRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched } from './rows.js'

/**
 * The tenancies, on D1.
 *
 * The one table in this package with no `org_id`, because it is the table that
 * says which orgs there are. It has no delete for the reason the port gives: an
 * org owns rows in all eleven other tables, and removing one is a cascade
 * nobody has specified.
 */

const SELECT = 'SELECT data FROM orgs'

/**
 * `DO NOTHING` rather than an update, because the slug is a CLAIM: the first
 * writer owns it and a second caller needs to be told which row won rather than
 * quietly renaming somebody else's tenancy. `RETURNING` is on the statement so
 * the winner comes back in one round trip; an insert that did nothing returns no
 * row, and the caller reads the holder instead.
 */
const CLAIM = `INSERT INTO orgs (id, slug, created_at, data)
VALUES (?, ?, ?, ?)
ON CONFLICT DO NOTHING
RETURNING data`

export class SqlOrgRepository implements OrgRepository {
  constructor(private readonly db: SqlDriver) {}

  async list(): Promise<Org[]> {
    const rows = await this.db.all(`${SELECT} ORDER BY created_at, id`)
    return decodeRows(orgSchema, 'orgs', rows)
  }

  async getById(orgId: string): Promise<Org | null> {
    const row = await this.db.first(`${SELECT} WHERE id = ?`, [orgId])
    return row === null ? null : decodeData(orgSchema, 'orgs', row.data)
  }

  async getBySlug(slug: string): Promise<Org | null> {
    const row = await this.db.first(`${SELECT} WHERE slug = ?`, [slug])
    return row === null ? null : decodeData(orgSchema, 'orgs', row.data)
  }

  async create(org: Org): Promise<Org> {
    const row = await this.db.first(CLAIM, [org.id, org.slug, org.createdAt, encodeData(org)])
    if (row !== null) return decodeData(orgSchema, 'orgs', row.data)
    // Lost the claim, on either key. The holder of the SLUG is the answer when
    // there is one: an id collision means the same org, and a slug collision
    // means a different one already has the name, which is what the caller has
    // to be told.
    return (await this.getBySlug(org.slug)) ?? (await this.getById(org.id)) ?? org
  }

  async update(orgId: string, patch: Partial<Org>): Promise<Org | null> {
    const current = await this.getById(orgId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.db.run('UPDATE orgs SET slug = ?, data = ? WHERE id = ?', [
      next.slug,
      encodeData(next),
      orgId,
    ])
    return next
  }
}
