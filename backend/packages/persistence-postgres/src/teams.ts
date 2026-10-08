import type { Team } from '@sainte-beuve/contracts'
import type { TeamRepository } from '@sainte-beuve/kernel'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresDatabase } from './database.js'
import { firstOr, patched } from './rows.js'
import { teams } from './schema.js'

/** What a name is unique as, computed here so it matches the other stores exactly. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

export class PostgresTeamRepository implements TeamRepository {
  constructor(
    private readonly db: PostgresDatabase,
    private readonly orgId: string,
  ) {}

  async list(): Promise<Team[]> {
    const rows = await this.db
      .select({ data: teams.data })
      .from(teams)
      .where(eq(teams.orgId, this.orgId))
      .orderBy(asc(teams.nameKey), asc(teams.id))
    return rows.map((row) => row.data)
  }

  async getById(teamId: string): Promise<Team | null> {
    const rows = await this.db
      .select({ data: teams.data })
      .from(teams)
      .where(and(eq(teams.orgId, this.orgId), eq(teams.id, teamId)))
    return firstOr(rows)?.data ?? null
  }

  async getByName(name: string): Promise<Team | null> {
    const rows = await this.db
      .select({ data: teams.data })
      .from(teams)
      .where(and(eq(teams.orgId, this.orgId), eq(teams.nameKey, nameKey(name))))
    return firstOr(rows)?.data ?? null
  }

  /** The first writer owns a name. A lost claim returns no row, and the holder is read instead. */
  async create(team: Team): Promise<Team> {
    const inserted = await this.db
      .insert(teams)
      .values({
        orgId: this.orgId,
        id: team.id,
        nameKey: nameKey(team.name),
        createdAt: team.createdAt,
        data: team,
      })
      .onConflictDoNothing()
      .returning({ data: teams.data })
    const won = firstOr(inserted)
    if (won !== null) return won.data
    return (await this.getByName(team.name)) ?? (await this.getById(team.id)) ?? team
  }

  async update(
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'ownerId'>>,
  ): Promise<Team | null> {
    const current = await this.getById(teamId)
    if (current === null) return null
    const next = patched<Team>(current, patch)
    await this.db
      .update(teams)
      .set({ nameKey: nameKey(next.name), data: next })
      .where(and(eq(teams.orgId, this.orgId), eq(teams.id, teamId)))
    return next
  }

  async delete(teamId: string): Promise<void> {
    await this.db.delete(teams).where(and(eq(teams.orgId, this.orgId), eq(teams.id, teamId)))
  }
}
