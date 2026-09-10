import type {
  AttentionRequest,
  AttentionStatus,
  IdentityProvider,
  LinkedIdentity,
  Project,
  ReviewCommitment,
} from '@sainte-beuve/contracts'
import type {
  AttentionRepository,
  IdentityRepository,
  ProjectRepository,
  ReviewCommitmentRepository,
} from '@sainte-beuve/kernel'
import { projectRefKey, pullRequestKey } from '@sainte-beuve/kernel'
import { clone, patched } from './clone.js'

/**
 * The workspace half of the in-memory store: the projects a deployment watches,
 * who the people in it are known as on each host, the attention requests in
 * flight, and the commitments people made.
 *
 * Same contract as the board half (`stores.ts`): every read returns a COPY, and
 * the ports stay coarse enough for D1 and Postgres to implement without an N+1.
 * Split across two files only because one would be past the size budget.
 */

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly rows = new Map<string, Project>()

  async list(): Promise<Project[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt - b.createdAt).map(clone)
  }

  async getById(projectId: string): Promise<Project | null> {
    const row = this.rows.get(projectId)
    return row === undefined ? null : clone(row)
  }

  async getByRef(ref: { provider: string; owner: string; repo: string }): Promise<Project | null> {
    const wanted = projectRefKey(ref)
    for (const row of this.rows.values()) {
      if (projectRefKey(row) === wanted) return clone(row)
    }
    return null
  }

  async create(project: Project): Promise<Project> {
    this.rows.set(project.id, clone(project))
    return clone(project)
  }

  async update(projectId: string, patch: Partial<Project>): Promise<Project | null> {
    const row = this.rows.get(projectId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(projectId, next)
    return clone(next)
  }

  async delete(projectId: string): Promise<void> {
    this.rows.delete(projectId)
  }
}

/**
 * Linked accounts, keyed on `(provider, subject)` exactly as the durable table
 * will be. Storing the reviewer id beside the identity rather than a list on
 * the reviewer is what keeps the lookup a point read: the question asked on
 * every workspace load is "whose account is this?", not "what accounts does
 * this person have?".
 */
export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly rows = new Map<string, { reviewerId: string; identity: LinkedIdentity }>()

  async findReviewerId(provider: IdentityProvider, subject: string): Promise<string | null> {
    return this.rows.get(identityKey(provider, subject))?.reviewerId ?? null
  }

  async listForReviewer(reviewerId: string): Promise<LinkedIdentity[]> {
    return [...this.rows.values()]
      .filter((row) => row.reviewerId === reviewerId)
      .map((row) => clone(row.identity))
  }

  async link(reviewerId: string, identity: LinkedIdentity): Promise<string> {
    const key = identityKey(identity.provider, identity.subject)
    const held = this.rows.get(key)
    // First claim wins, which is the uniqueness the durable table will enforce
    // with a constraint on the key. A second person cannot take an account off
    // the row that already holds it; they are told whose it is instead.
    if (held !== undefined && held.reviewerId !== reviewerId) return held.reviewerId
    this.rows.set(key, { reviewerId, identity: clone(identity) })
    return reviewerId
  }
}

function identityKey(provider: IdentityProvider, subject: string): string {
  return `${provider}:${subject}`
}

export class InMemoryAttentionRepository implements AttentionRepository {
  private readonly rows = new Map<string, AttentionRequest>()

  async list(filter?: { status?: AttentionStatus[] }): Promise<AttentionRequest[]> {
    const wanted = filter?.status
    return [...this.rows.values()]
      .filter((row) => wanted === undefined || wanted.includes(row.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone)
  }

  async getById(attentionId: string): Promise<AttentionRequest | null> {
    const row = this.rows.get(attentionId)
    return row === undefined ? null : clone(row)
  }

  async create(request: AttentionRequest): Promise<AttentionRequest> {
    this.rows.set(request.id, clone(request))
    return clone(request)
  }

  async update(
    attentionId: string,
    patch: Partial<AttentionRequest>,
  ): Promise<AttentionRequest | null> {
    const row = this.rows.get(attentionId)
    if (row === undefined) return null
    const next = patched(row, patch)
    this.rows.set(attentionId, next)
    return clone(next)
  }
}

export class InMemoryReviewCommitmentRepository implements ReviewCommitmentRepository {
  private readonly rows = new Map<string, ReviewCommitment>()

  async listByReviewer(reviewerId: string): Promise<ReviewCommitment[]> {
    return [...this.rows.values()]
      .filter((row) => row.reviewerId === reviewerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone)
  }

  async getById(commitmentId: string): Promise<ReviewCommitment | null> {
    const row = this.rows.get(commitmentId)
    return row === undefined ? null : clone(row)
  }

  async find(
    reviewerId: string,
    pullRequest: { provider: string; owner: string; repo: string; number: number },
  ): Promise<ReviewCommitment | null> {
    const wanted = pullRequestKey(pullRequest)
    for (const row of this.rows.values()) {
      if (row.reviewerId !== reviewerId) continue
      if (pullRequestKey(row.pullRequest) === wanted) return clone(row)
    }
    return null
  }

  async create(commitment: ReviewCommitment): Promise<ReviewCommitment> {
    this.rows.set(commitment.id, clone(commitment))
    return clone(commitment)
  }

  async delete(commitmentId: string): Promise<void> {
    this.rows.delete(commitmentId)
  }
}
