import type { CreateOrgInput, Org, OrgFounder, UpdateOrgInput } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_ID, defaultOrg, NO_VCS_HANDLES, withHandle } from '@sainte-beuve/contracts'
import { assertFound, ConflictError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'

/**
 * The tenancies.
 *
 * Almost everything about the boundary happens without this service: an org is a
 * column, the repositories are bound to one before a service sees them, and no
 * route takes one as an argument. What is left here is the operator's half —
 * seeing which orgs exist, making one, and naming the one a request is in so a
 * screen can say where it is.
 */
export class OrgService {
  constructor(private readonly container: AppContainer) {}

  /**
   * The org this request is in.
   *
   * SYNTHESISED when the row is not there, which is the ordinary state of a
   * deployment that never made a second org: every row it holds was backfilled
   * to the default id and nothing ever wrote the org itself. Writing it on first
   * read would make `GET /api/v1/auth/session` — the route every page polls — a
   * write, on a store that may be read-only while a restore is running.
   *
   * An org id that names nothing else is a credential from a tenancy somebody
   * has stopped using. It reads as an empty org rather than a refusal, for the
   * reason the provider gives: deciding who may call is the guard's job, not
   * this one's.
   */
  async current(): Promise<Org> {
    const held = await this.container.stores.orgs.getById(this.container.orgId)
    if (held !== null) return held
    return this.container.orgId === DEFAULT_ORG_ID
      ? defaultOrg()
      : { ...defaultOrg(), id: this.container.orgId, slug: this.container.orgId }
  }

  /**
   * Every org, with the default one folded in whether or not its row exists.
   *
   * Without that, a deployment that has made one extra org would list the new
   * one and not the tenancy all of its data is actually in, which reads as the
   * default org having been deleted.
   */
  async list(): Promise<Org[]> {
    const stored = await this.container.stores.orgs.list()
    return stored.some((org) => org.id === DEFAULT_ORG_ID) ? stored : [defaultOrg(), ...stored]
  }

  /**
   * Make one.
   *
   * The caller does NOT become a member of it, and that is the decision worth
   * recording: an operator minting orgs from one tenancy is not thereby a person
   * in the others. Who the new org's first admin is, is a decision this route
   * takes rather than a race it starts — name a `founder` and the directory has
   * an admin row before anybody is told the slug; leave it out and the first
   * account to complete a sign-in becomes the admin, which is a race with
   * whoever else knows the slug.
   *
   * The slug is a claim the store settles, so a name somebody else already holds
   * comes back as a conflict rather than as a silent rename of their org.
   */
  async create(input: CreateOrgInput): Promise<Org> {
    const { ids, clock, stores } = this.container
    const wanted: Org = {
      id: ids.next(),
      slug: input.slug,
      name: input.name,
      enrolment: input.enrolment,
      createdAt: clock.now(),
    }
    // The default org has no row until somebody makes one, so a deployment
    // creating `default` by hand would otherwise end up with two tenancies
    // answering to the name every unplaced caller lands in.
    if (wanted.slug === defaultOrg().slug) throw slugTaken(wanted.slug)
    const written = await stores.orgs.create(wanted)
    if (written.id !== wanted.id) throw slugTaken(wanted.slug)
    if (input.founder !== null) await this.seatFounder(written, input.founder)
    return written
  }

  /**
   * Change the org this request is in.
   *
   * It WRITES the default org's row on first use, which is the one place that
   * happens: the row is synthesised everywhere else so that the route every page
   * polls stays a read, and an operator changing a decision is exactly the
   * moment there is something to record.
   */
  async update(patch: UpdateOrgInput): Promise<Org> {
    const { stores, orgId } = this.container
    if ((await stores.orgs.getById(orgId)) === null) await stores.orgs.create(await this.current())
    return assertFound(await stores.orgs.update(orgId, patch), `No org ${orgId}`)
  }

  /**
   * The founding admin's directory row, in the new org.
   *
   * By HANDLE, because the host's stable subject for an account does not exist
   * here until that account signs in. The row is therefore a claim to be taken
   * rather than an identity, and `decideEnrolment` knows it: this is the only
   * row adoption may ever hand `admin` to, and only while no admin of the org
   * has signed in.
   */
  private async seatFounder(org: Org, founder: OrgFounder): Promise<void> {
    const { ids, clock, stores } = this.container
    await stores.forOrg(org.id).reviewers.create({
      id: ids.next(),
      displayName: founder.handle,
      handles: withHandle(NO_VCS_HANDLES, founder.provider, founder.handle),
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      role: 'admin',
      weight: 1,
      outstandingReviews: 0,
      createdAt: clock.now(),
    })
  }
}

function slugTaken(slug: string): ConflictError {
  return new ConflictError(`An org is already called "${slug}" on this deployment.`)
}
