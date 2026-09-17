import type { Org } from '@sainte-beuve/contracts'
import type { Repositories, StoredApiKey, StoredSession } from './repositories.js'

/**
 * The org boundary, as a port.
 *
 * Beside `repositories.ts` rather than inside it, and the split is the design
 * rather than a size budget: every interface in that file is a store BOUND TO AN
 * ORG, and every interface here is about deciding which one. Nothing below this
 * line takes an org as an argument, because nothing above it can be reached
 * without one.
 */

/**
 * The tenancies themselves. The one table that is NOT inside an org, because it
 * is the table that says which orgs there are.
 *
 * There is no delete. An org owns rows in all eleven other tables, so removing
 * one is a cascade across the whole store and a question — what happens to the
 * board, to the sessions, to the sealed credentials — that nobody has asked yet.
 * Until they do, an org that is finished with is an org nobody signs in to.
 */
export interface OrgRepository {
  /** Every org, oldest first. Read by an operator, and by the reminder tick. */
  list(): Promise<Org[]>
  getById(orgId: string): Promise<Org | null>
  /** The org behind the slug a sign-in named. */
  getBySlug(slug: string): Promise<Org | null>
  /**
   * Make one, or answer the one already holding the slug.
   *
   * The same shape `IdentityRepository.link` has, and for the same reason: the
   * slug is claimed by the first writer, and a caller that lost the race needs
   * to be told which row won rather than being handed a conflict it can do
   * nothing about.
   */
  create(org: Org): Promise<Org>
  update(orgId: string, patch: Partial<Org>): Promise<Org | null>
}

/**
 * The three reads that DECIDE an org, and which therefore cannot be asked of a
 * store already bound to one.
 *
 * Deliberately three methods and not a way in: nothing here reads a board, a
 * directory or a registry. Two of them resolve a credential to the tenancy it
 * belongs to, and the third answers the question an inbound webhook has instead
 * of a credential — which org registered this repository. Everything a request
 * does afterwards goes through `forOrg`.
 */
export interface TenancyDirectory {
  /** The session a presented token belongs to, expired or not: the caller decides. */
  findSessionByDigest(tokenDigest: string): Promise<StoredSession | null>
  findApiKeyByDigest(tokenDigest: string): Promise<StoredApiKey | null>
  /**
   * The org that registered a repository, or null for one nobody registered.
   *
   * A delivery from GitHub carries no credential of ours, so the project
   * registry is what places it: registering a repository is a tenancy claiming
   * responsibility for it, and that claim is exactly what an intake needs. A
   * repository two orgs registered answers with the first to have claimed it,
   * which is the same first-writer rule every other key here follows.
   */
  findOrgIdForProject(ref: {
    provider: string
    owner: string
    repo: string
  }): Promise<string | null>
}

/**
 * What a runtime actually wires: the orgs, the reads that place a caller in one,
 * and a way to get the eleven repositories bound to it.
 *
 * `forOrg` is called once per request, by the middleware that resolved the
 * caller, and what it hands back is what every service below sees. It has to be
 * CHEAP — it is on the path of every request — so an implementation binds an id
 * and builds statements, and never opens a connection or reads a row.
 */
export interface PersistenceProvider {
  readonly orgs: OrgRepository
  readonly tenancy: TenancyDirectory
  /**
   * The eleven stores, bound to one org.
   *
   * An id that belongs to no org is not an error here: a store answers it with
   * empty lists and nulls, which is what a request carrying a credential from a
   * tenancy somebody removed should see. Refusing would make the provider the
   * place that decides who may call, and that decision belongs above it.
   */
  forOrg(orgId: string): Repositories
}
