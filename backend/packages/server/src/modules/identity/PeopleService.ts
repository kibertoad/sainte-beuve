import type {
  LinkedIdentity,
  OrgEnrolment,
  Reviewer,
  Role,
  VcsProvider,
} from '@sainte-beuve/contracts'
import { defaultOrg, NO_VCS_HANDLES, withHandle } from '@sainte-beuve/contracts'
import { assertFound, ForbiddenError, type VcsAccount } from '@sainte-beuve/kernel'
import { decideEnrolment, type EnrolmentDecision, isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'

/**
 * The person behind one host account.
 *
 * Its own service because two callers need exactly this and must not disagree
 * about it: the sign-in that establishes a session has to know whose session it
 * is, and the viewer read has to answer the same question for a deployment
 * running open with no session at all. A second copy of the claim rule is how a
 * directory comes to hold two rows for one human being.
 *
 * What it deliberately does NOT do is treat the handle as the identity. The
 * account's stable subject is the key, the handle is refreshed from it, and the
 * person behind it is a reviewer row. So a rename keeps somebody's workspace,
 * the next holder of the name does not inherit it, and one person can hold a
 * GitHub and a GitLab account at once.
 *
 * Nor does it treat a finished sign-in as permission to be here. Whether an
 * account may become a person in this org is `decideEnrolment` in
 * @sainte-beuve/reviewers — a pure decision over the org's enrolment, the
 * directory and the row the handle matched — and this service is what reads
 * those facts and writes the answer down.
 */
const NOT_ENROLLED =
  'This org admits people its admins have registered. Ask an admin of it to add you to the ' +
  'directory under this account\u2019s handle, and sign in again.'

/**
 * Whether the enrolment decision is being asked on behalf of somebody who has
 * ALREADY been authorised by something else.
 *
 * `trusted` is the deployment's own credential acting as a person (the viewer on
 * an `open` deployment) and the operator's connect round trip, which is an
 * admin-only route: in both, somebody with authority over this org caused the
 * account to appear. `enforced` is a plain sign-in, which authorises nothing on
 * its own \u2014 any account can authorise any OAuth app on github.com.
 */
export type EnrolmentGate = 'trusted' | 'enforced'

/** A person about to be written down: the account, and what the decision allowed. */
interface Newcomer {
  provider: VcsProvider
  account: VcsAccount
  role: Role
}

/**
 * A directory row this account may take, and what kind of taking it is.
 *
 * The two travel together because one store read answers both, and asking twice
 * would be a `listForReviewer` per candidate per sign-in.
 */
interface Adoptable {
  reviewer: Reviewer
  /**
   * The row is already linked on ANOTHER host: this is a second account of
   * somebody this org admitted, not a stranger taking an unclaimed registration.
   * See `decideEnrolment`.
   */
  established: boolean
}

export class PeopleService {
  constructor(private readonly container: AppContainer) {}

  /**
   * The reviewer row behind one host account, for a caller some other authority
   * has already vouched for. See `EnrolmentGate`.
   */
  async reviewerFor(provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    return this.resolve(provider, account, 'trusted')
  }

  /**
   * The reviewer row behind a host account that has just SIGNED IN, refusing one
   * this org has not admitted. See `decideEnrolment` in @sainte-beuve/reviewers.
   */
  async enrol(provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    return this.resolve(provider, account, 'enforced')
  }

  private async resolve(
    provider: VcsProvider,
    account: VcsAccount,
    gate: EnrolmentGate,
  ): Promise<Reviewer> {
    const linkedId = await this.container.repositories.identities.findReviewerId(
      provider,
      account.subject,
    )
    // An account already linked to a row is a person this org admitted once, and
    // enrolment is not asked again: closing the door is about who may JOIN, and
    // taking somebody's access away is `availability: paused`.
    if (linkedId !== null) return this.refresh(linkedId, provider, account)
    return this.claim(provider, account, gate)
  }

  /**
   * The person behind an account nothing has claimed yet: an existing directory
   * row registered for the same handle, else a new one — and only where this org
   * ADMITS the account at all.
   *
   * Adopting the existing row is what stops the directory forking on the way
   * IN. A team registers people by hand long before anybody signs in, and
   * creating a second row for the same human the first time they open the
   * workspace would give them an empty skill list and leave the router drawing
   * the other row.
   *
   * The account is claimed BEFORE the row is written, and the claim is what
   * decides. This runs on a GET, and one page load fires three of them at once
   * (the workspace, the inbox and the stream): three requests that each looked
   * for a row, found none and created one would fork the directory into three
   * people with a single identity between them, two of them orphans the
   * reviewer screen still draws. The store keys the claim on
   * `(provider, subject)`, so the first to land owns the person and the others
   * are told whose it is.
   */
  private async claim(
    provider: VcsProvider,
    account: VcsAccount,
    gate: EnrolmentGate,
  ): Promise<Reviewer> {
    const { repositories, ids } = this.container
    const directory = await repositories.reviewers.list()
    const adopted = await this.adoptable(directory, provider, account)
    const decision = await this.admit(directory, adopted, gate)
    if (!decision.admitted) throw new ForbiddenError(NOT_ENROLLED)
    const claimedId = adopted?.reviewer.id ?? ids.next()
    const ownerId = await repositories.identities.link(
      claimedId,
      this.identityOf(provider, account),
    )
    if (ownerId !== claimedId) {
      return this.claimedElsewhere(ownerId, { provider, account, role: decision.role })
    }
    if (adopted !== null) return this.adopt(adopted.reviewer, decision.role)
    return this.create(claimedId, { provider, account, role: decision.role })
  }

  /**
   * The directory row this account may take, or null.
   *
   * Matched on the handle, which is all an admin can know before somebody has
   * ever signed in — and refused for a row an account has ALREADY proved itself
   * against ON THIS HOST. That second half is the difference between a hint and
   * an identity: without it, whoever holds the GitHub login `bob` takes the row
   * of the Bob whose GitHub account is already linked to it, along with their
   * workspace, their commitments and their role.
   *
   * PER HOST, because a claim is spent per host. `handles` is a map with a slot
   * per provider, an admin registers each slot separately, and the row's GitLab
   * slot is untouched by whoever proved themselves against its GitHub one. Made
   * unconditional, this is the only way to link a second account — `refresh`
   * only ever re-records the handle of a provider already linked — so a person
   * who signed in with GitHub could never add their GitLab account: 403 forever
   * under `invite`, and a second directory row under `open`, which is the fork
   * `claim` exists to prevent.
   */
  private async adoptable(
    directory: readonly Reviewer[],
    provider: VcsProvider,
    account: VcsAccount,
  ): Promise<Adoptable | null> {
    const { identities } = this.container.repositories
    for (const reviewer of directory) {
      if (!isSameHandle(reviewer.handles[provider], account.username)) continue
      const linked = await identities.listForReviewer(reviewer.id)
      if (linked.some((identity) => identity.provider === provider)) continue
      return { reviewer, established: linked.length > 0 }
    }
    return null
  }

  /** Whether this org admits the account, and as what. */
  private async admit(
    directory: readonly Reviewer[],
    adopted: Adoptable | null,
    gate: EnrolmentGate,
  ): Promise<EnrolmentDecision> {
    return decideEnrolment({
      // A trusted caller IS an org with open enrolment: the authority that
      // admitted them is elsewhere (see `EnrolmentGate`), and the rest of the
      // decision — the founder, the adoption, the cap on `admin` — still holds.
      enrolment: gate === 'trusted' ? 'open' : await this.enrolment(),
      directorySize: directory.length,
      adoptedRole: adopted?.reviewer.role ?? null,
      adoptedEstablished: adopted?.established ?? false,
      // Only asked where it can change the answer, because it costs a read per
      // admin row.
      hasLinkedAdmin:
        adopted?.reviewer.role === 'admin' ? await this.hasLinkedAdmin(directory) : false,
    })
  }

  /** This org's decision about who may join, or `invite` for a row nobody wrote. */
  private async enrolment(): Promise<OrgEnrolment> {
    const held = await this.container.stores.orgs.getById(this.container.orgId)
    return held?.enrolment ?? defaultOrg().enrolment
  }

  /** Whether any admin of this org has ever signed in. */
  private async hasLinkedAdmin(directory: readonly Reviewer[]): Promise<boolean> {
    for (const reviewer of directory) {
      if (reviewer.role !== 'admin') continue
      if (await this.isLinked(reviewer)) return true
    }
    return false
  }

  private async isLinked(reviewer: Reviewer): Promise<boolean> {
    const linked = await this.container.repositories.identities.listForReviewer(reviewer.id)
    return linked.length > 0
  }

  /**
   * Take the registered row, writing the role the decision allowed.
   *
   * The write happens only where the two DIFFER, which is exactly the case the
   * cap exists for: a row pre-registered as `admin` that adoption may not hand
   * `admin` to keeps the person, the skills and the team, and loses the role an
   * admin has to grant again once they can see who took it.
   */
  private async adopt(adopted: Reviewer, role: Role): Promise<Reviewer> {
    if (adopted.role === role) return adopted
    return assertFound(
      await this.container.repositories.reviewers.update(adopted.id, { role }),
      `No reviewer ${adopted.id}`,
    )
  }

  /** The row of whoever won the claim. */
  private async claimedElsewhere(ownerId: string, newcomer: Newcomer): Promise<Reviewer> {
    const existing = await this.container.repositories.reviewers.getById(ownerId)
    if (existing !== null) return existing
    // The winner claimed the account and has not written its row yet. It is the
    // same account either way, so writing the row under the id the claim points
    // at converges on the ONE person rather than answering this request with a
    // reviewer that does not exist. The role is THIS request's decision, which
    // is the same one the winner reached: both racers asked about one account
    // against one directory, so writing anything else here would be a founding
    // sign-in that lost a race and left the org without an admin.
    return this.create(ownerId, newcomer)
  }

  private async create(id: string, newcomer: Newcomer): Promise<Reviewer> {
    const { provider, account, role } = newcomer
    return this.container.repositories.reviewers.create({
      id,
      displayName: account.displayName ?? account.username,
      handles: withHandle(NO_VCS_HANDLES, provider, account.username),
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      role,
      weight: 1,
      outstandingReviews: 0,
      createdAt: this.container.clock.now(),
    })
  }

  /**
   * Re-record the handle every time, because it is the one field that changes
   * under us: somebody who renames on the host would otherwise keep being
   * mirrored onto pull requests under a name the host no longer routes.
   */
  private async refresh(
    reviewerId: string,
    provider: VcsProvider,
    account: VcsAccount,
  ): Promise<Reviewer> {
    const { repositories } = this.container
    const reviewer = assertFound(
      await repositories.reviewers.getById(reviewerId),
      `No reviewer ${reviewerId}`,
    )
    if (isSameHandle(reviewer.handles[provider], account.username)) return reviewer
    await repositories.identities.link(reviewerId, this.identityOf(provider, account))
    return assertFound(
      await repositories.reviewers.update(reviewerId, {
        handles: withHandle(reviewer.handles, provider, account.username),
      }),
      `No reviewer ${reviewerId}`,
    )
  }

  private identityOf(provider: VcsProvider, account: VcsAccount): LinkedIdentity {
    return {
      provider,
      subject: account.subject,
      username: account.username,
      linkedAt: this.container.clock.now(),
    }
  }
}
