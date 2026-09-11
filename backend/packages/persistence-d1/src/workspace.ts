import type { IdentityProvider, LinkedIdentity, Project } from '@sainte-beuve/contracts'
import { linkedIdentitySchema, projectSchema } from '@sainte-beuve/contracts'
import type { IdentityRepository, ProjectRepository } from '@sainte-beuve/kernel'
import { projectRefKey } from '@sainte-beuve/kernel'
import type { SqlDriver } from './driver.js'
import { decodeData, decodeRows, encodeData, patched } from './rows.js'

/**
 * The projects a deployment watches, and who the people in it are known as on
 * each host.
 */

const PROJECT_UPSERT = `INSERT INTO projects (id, ref_key, created_at, data)
VALUES (?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  ref_key = excluded.ref_key,
  created_at = excluded.created_at,
  data = excluded.data`

export class SqlProjectRepository implements ProjectRepository {
  constructor(private readonly db: SqlDriver) {}

  async list(): Promise<Project[]> {
    const rows = await this.db.all('SELECT data FROM projects ORDER BY created_at, id')
    return decodeRows(projectSchema, 'projects', rows)
  }

  async getById(projectId: string): Promise<Project | null> {
    const row = await this.db.first('SELECT data FROM projects WHERE id = ?', [projectId])
    return row === null ? null : decodeData(projectSchema, 'projects', row.data)
  }

  async getByRef(ref: { provider: string; owner: string; repo: string }): Promise<Project | null> {
    const row = await this.db.first('SELECT data FROM projects WHERE ref_key = ?', [
      projectRefKey(ref),
    ])
    return row === null ? null : decodeData(projectSchema, 'projects', row.data)
  }

  async create(project: Project): Promise<Project> {
    await this.write(project)
    return project
  }

  async update(projectId: string, patch: Partial<Project>): Promise<Project | null> {
    const current = await this.getById(projectId)
    if (current === null) return null
    const next = patched(current, patch)
    await this.write(next)
    return next
  }

  async delete(projectId: string): Promise<void> {
    await this.db.run('DELETE FROM projects WHERE id = ?', [projectId])
  }

  private async write(project: Project): Promise<void> {
    // `ref_key` carries a UNIQUE index, which is the uniqueness the port
    // declares and the in-memory store can only promise. Registering a
    // repository that is already registered is refused by the service, so
    // reaching the constraint means two of those calls raced, and the loser
    // being told so beats a workspace listing one repository twice.
    await this.db.run(PROJECT_UPSERT, [
      project.id,
      projectRefKey(project),
      project.createdAt,
      encodeData(project),
    ])
  }
}

/**
 * The `(provider, subject)` claim, settled in ONE statement.
 *
 * `link` has to answer "whose account is this NOW", and the answer is not always
 * the reviewer that was passed in: two first sign-ins that both found no row are
 * how a directory forks into two people with one account between them. The
 * in-memory store reads and then writes and can only promise this; here the
 * primary key decides it, the conflict branch leaves the holder's `reviewer_id`
 * alone, and `RETURNING` reports who won. A caller that already holds the key
 * refreshes the handle on the same trip, which is what keeps a rename visible.
 */
const IDENTITY_CLAIM = `INSERT INTO identities (provider, subject, reviewer_id, data)
VALUES (?, ?, ?, ?)
ON CONFLICT (provider, subject) DO UPDATE SET
  data = CASE
    WHEN identities.reviewer_id = excluded.reviewer_id THEN excluded.data
    ELSE identities.data
  END
RETURNING reviewer_id`

export class SqlIdentityRepository implements IdentityRepository {
  constructor(private readonly db: SqlDriver) {}

  async findReviewerId(provider: IdentityProvider, subject: string): Promise<string | null> {
    const row = await this.db.first(
      'SELECT reviewer_id FROM identities WHERE provider = ? AND subject = ?',
      [provider, subject],
    )
    return row === null ? null : String(row.reviewer_id)
  }

  async listForReviewer(reviewerId: string): Promise<LinkedIdentity[]> {
    const rows = await this.db.all(
      'SELECT data FROM identities WHERE reviewer_id = ? ORDER BY provider, subject',
      [reviewerId],
    )
    return decodeRows(linkedIdentitySchema, 'identities', rows)
  }

  async link(reviewerId: string, identity: LinkedIdentity): Promise<string> {
    const row = await this.db.first(IDENTITY_CLAIM, [
      identity.provider,
      identity.subject,
      reviewerId,
      encodeData(identity),
    ])
    // The statement always returns its row, whether it inserted or conflicted.
    // A driver that answered nothing would mean the claim did not happen, and
    // reporting the caller as the holder then would be a guess.
    return row === null ? reviewerId : String(row.reviewer_id)
  }
}
