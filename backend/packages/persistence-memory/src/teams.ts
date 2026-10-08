import type { Team } from '@sainte-beuve/contracts'
import type { TeamRepository } from '@sainte-beuve/kernel'
import { clone } from './clone.js'
import { byText } from './order.js'

/** What a team name is unique as: the durable stores' `name_key` column. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** One org's teams, ordered `name_key, id` as the durable stores order them. */
export class InMemoryTeamRepository implements TeamRepository {
  private readonly rows = new Map<string, Team>()

  async list(): Promise<Team[]> {
    return [...this.rows.values()]
      .sort((a, b) => byText(nameKey(a.name), nameKey(b.name)) || byText(a.id, b.id))
      .map(clone)
  }

  async getById(teamId: string): Promise<Team | null> {
    const row = this.rows.get(teamId)
    return row === undefined ? null : clone(row)
  }

  async getByName(name: string): Promise<Team | null> {
    const key = nameKey(name)
    for (const row of this.rows.values()) {
      if (nameKey(row.name) === key) return clone(row)
    }
    return null
  }

  /** First writer owns the name, and the loser is told which row won. */
  async create(team: Team): Promise<Team> {
    const held = (await this.getByName(team.name)) ?? this.rows.get(team.id)
    if (held !== undefined && held !== null) return clone(held)
    this.rows.set(team.id, clone(team))
    return clone(team)
  }

  async update(
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'ownerId'>>,
  ): Promise<Team | null> {
    const row = this.rows.get(teamId)
    if (row === undefined) return null
    const next = clone({ ...row, ...patch, id: row.id })
    this.rows.set(teamId, next)
    return clone(next)
  }

  async delete(teamId: string): Promise<void> {
    this.rows.delete(teamId)
  }
}
