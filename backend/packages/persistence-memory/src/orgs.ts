import type { Org } from '@sainte-beuve/contracts'
import type { OrgRepository } from '@sainte-beuve/kernel'
import { clone, patched } from './clone.js'
import { byText, oldestFirst } from './order.js'

/**
 * The tenancies, in memory.
 *
 * The one store that is not inside an org, so it is not per-dataset: it is the
 * table that says which datasets there are. Everything else about it follows the
 * same rules as the rest of this adapter — every read is a copy, and the order
 * is the one the durable stores spell in SQL.
 */
export class InMemoryOrgRepository implements OrgRepository {
  private readonly rows = new Map<string, Org>()

  async list(): Promise<Org[]> {
    return [...this.rows.values()].sort(oldestFirst((row) => row.createdAt)).map(clone)
  }

  async getById(orgId: string): Promise<Org | null> {
    const row = this.rows.get(orgId)
    return row === undefined ? null : clone(row)
  }

  async getBySlug(slug: string): Promise<Org | null> {
    for (const row of this.rows.values()) {
      if (byText(row.slug, slug) === 0) return clone(row)
    }
    return null
  }

  /** First writer owns the slug, and the loser is told which row won. */
  async create(org: Org): Promise<Org> {
    const held = (await this.getBySlug(org.slug)) ?? this.rows.get(org.id)
    if (held !== undefined && held !== null) return clone(held)
    this.rows.set(org.id, clone(org))
    return clone(org)
  }

  async update(orgId: string, patch: Partial<Org>): Promise<Org | null> {
    const row = this.rows.get(orgId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(orgId, next)
    return clone(next)
  }
}
