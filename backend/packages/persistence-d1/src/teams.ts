import type { Team } from '@sainte-beuve/contracts'
import { teamSchema } from '@sainte-beuve/contracts'
import type { TeamRepository } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched } from './rows.js'

const SELECT = 'SELECT data FROM teams'

/** The first writer owns a name. A lost claim returns no row, and the holder is read instead. */
const CLAIM = `INSERT INTO teams (org_id, id, name_key, created_at, data)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING
RETURNING data`

/** What a name is unique as, computed here rather than in SQL, whose `lower` is ASCII-only. */
function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

export class SqlTeamRepository implements TeamRepository {
  constructor(
    private readonly db: SqlDriver,
    private readonly orgId: string,
  ) {}

  async list(): Promise<Team[]> {
    const rows = await this.db.all(`${SELECT} WHERE org_id = ? ORDER BY name_key, id`, [this.orgId])
    return decodeRows(teamSchema, 'teams', rows)
  }

  async getById(teamId: string): Promise<Team | null> {
    const row = await this.db.first(`${SELECT} WHERE org_id = ? AND id = ?`, [this.orgId, teamId])
    return row === null ? null : decodeData(teamSchema, 'teams', row.data)
  }

  async getByName(name: string): Promise<Team | null> {
    const row = await this.db.first(`${SELECT} WHERE org_id = ? AND name_key = ?`, [
      this.orgId,
      nameKey(name),
    ])
    return row === null ? null : decodeData(teamSchema, 'teams', row.data)
  }

  async create(team: Team): Promise<Team> {
    const row = await this.db.first(CLAIM, [
      this.orgId,
      team.id,
      nameKey(team.name),
      team.createdAt,
      encodeData(team),
    ])
    if (row !== null) return decodeData(teamSchema, 'teams', row.data)
    return (await this.getByName(team.name)) ?? (await this.getById(team.id)) ?? team
  }

  async update(
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'ownerId'>>,
  ): Promise<Team | null> {
    const current = await this.getById(teamId)
    if (current === null) return null
    const next = patched<Team>(current, patch)
    await this.db.run('UPDATE teams SET name_key = ?, data = ? WHERE org_id = ? AND id = ?', [
      nameKey(next.name),
      encodeData(next),
      this.orgId,
      teamId,
    ])
    return next
  }

  async delete(teamId: string): Promise<void> {
    await this.db.run('DELETE FROM teams WHERE org_id = ? AND id = ?', [this.orgId, teamId])
  }
}
