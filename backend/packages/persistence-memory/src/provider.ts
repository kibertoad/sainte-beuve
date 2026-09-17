import type {
  PersistenceProvider,
  Repositories,
  StoredApiKey,
  StoredSession,
  TenancyDirectory,
} from '@sainte-beuve/kernel'
import { InMemoryApiKeyRepository, InMemorySessionRepository } from './auth-stores.js'
import { InMemoryOrgRepository } from './orgs.js'
import { createInMemoryRepositories } from './stores.js'
import { InMemoryProjectRepository } from './workspace-stores.js'

/**
 * The in-memory store as a whole deployment sees it: the orgs, the reads that
 * place a caller in one, and one dataset per org.
 *
 * ISOLATION HERE IS STRUCTURAL rather than filtered. The durable adapters carry
 * an `org_id` column and put it in every statement; this one hands each org its
 * own set of maps, so there is no predicate to get wrong and no row of one
 * tenancy within reach of another's read. The conformance suite holds both
 * arrangements to the same behaviour, which is the point of running it three
 * ways.
 *
 * A dataset is created on first use, including for an org id that names nothing.
 * That is deliberate: a credential minted in a tenancy somebody has since
 * stopped using should see an empty board rather than an error, and deciding
 * who may call is not a store's job.
 */
class InMemoryPersistence implements PersistenceProvider {
  readonly orgs = new InMemoryOrgRepository()
  private readonly datasets = new Map<string, OrgDataset>()

  readonly tenancy: TenancyDirectory = {
    findSessionByDigest: async (tokenDigest) => this.scanSessions(tokenDigest),
    findApiKeyByDigest: async (tokenDigest) => this.scanApiKeys(tokenDigest),
    findOrgIdForProject: async (ref) => this.scanProjects(ref),
  }

  forOrg(orgId: string): Repositories {
    return this.datasetFor(orgId)
  }

  private datasetFor(orgId: string): OrgDataset {
    const held = this.datasets.get(orgId)
    if (held !== undefined) return held
    const created = createInMemoryRepositories() as OrgDataset
    this.datasets.set(orgId, created)
    return created
  }

  /**
   * A scan across every org, which is what the digest indexes are for in the
   * durable stores. The cost is the same one this adapter already pays for
   * `getByRef` and for its own digest lookups: it holds a laptop's worth of
   * rows, and a second index here would be a second thing to keep in step for a
   * store that is emptied by a restart.
   */
  private async scanSessions(tokenDigest: string): Promise<StoredSession | null> {
    for (const dataset of this.datasets.values()) {
      const held = await dataset.sessions.findByDigest(tokenDigest)
      if (held !== null) return held
    }
    return null
  }

  private async scanApiKeys(tokenDigest: string): Promise<StoredApiKey | null> {
    for (const dataset of this.datasets.values()) {
      const held = await dataset.apiKeys.findByDigest(tokenDigest)
      if (held !== null) return held
    }
    return null
  }

  private async scanProjects(ref: {
    provider: string
    owner: string
    repo: string
  }): Promise<string | null> {
    for (const [orgId, dataset] of this.datasets) {
      if ((await dataset.projects.getByRef(ref)) !== null) return orgId
    }
    return null
  }
}

/**
 * One org's maps, typed against the concrete classes rather than the ports.
 *
 * The three lookups above are not on the ports — resolving a digest is what
 * DECIDES an org, so it cannot be asked of a store already inside one — and this
 * is where the adapter's own wider surface is admitted rather than smuggled in
 * behind a cast at each call site.
 */
interface OrgDataset extends Repositories {
  sessions: InMemorySessionRepository
  apiKeys: InMemoryApiKeyRepository
  projects: InMemoryProjectRepository
}

/** The whole in-memory store, orgs and all: what a facade with no database boots with. */
export function createInMemoryPersistence(): PersistenceProvider {
  return new InMemoryPersistence()
}
