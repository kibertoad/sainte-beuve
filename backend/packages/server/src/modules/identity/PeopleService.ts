import type { LinkedIdentity, Reviewer, Role, VcsProvider } from '@sainte-beuve/contracts'
import { NO_VCS_HANDLES, withHandle } from '@sainte-beuve/contracts'
import { assertFound, type VcsAccount } from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
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
 */
export class PeopleService {
  constructor(private readonly container: AppContainer) {}

  /** The reviewer row behind one host account: the linked one, else claimed. */
  async reviewerFor(provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    const linkedId = await this.container.repositories.identities.findReviewerId(
      provider,
      account.subject,
    )
    if (linkedId !== null) return this.refresh(linkedId, provider, account)
    return this.claim(provider, account)
  }

  /**
   * The person behind an account nothing has claimed yet: an existing directory
   * row with the same handle, else a new one.
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
  private async claim(provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    const { repositories, ids } = this.container
    const adopted = (await repositories.reviewers.list()).find((reviewer) =>
      isSameHandle(reviewer.handles[provider], account.username),
    )
    const claimedId = adopted?.id ?? ids.next()
    const ownerId = await repositories.identities.link(
      claimedId,
      this.identityOf(provider, account),
    )
    if (ownerId !== claimedId) return this.claimedElsewhere(ownerId, provider, account)
    return adopted ?? this.create(claimedId, provider, account)
  }

  /** The row of whoever won the claim. */
  private async claimedElsewhere(
    ownerId: string,
    provider: VcsProvider,
    account: VcsAccount,
  ): Promise<Reviewer> {
    const existing = await this.container.repositories.reviewers.getById(ownerId)
    if (existing !== null) return existing
    // The winner claimed the account and has not written its row yet. It is the
    // same account either way, so writing the row under the id the claim points
    // at converges on the ONE person rather than answering this request with a
    // reviewer that does not exist.
    return this.create(ownerId, provider, account)
  }

  private async create(id: string, provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    return this.container.repositories.reviewers.create({
      id,
      displayName: account.displayName ?? account.username,
      handles: withHandle(NO_VCS_HANDLES, provider, account.username),
      slackUserId: null,
      team: null,
      skills: [],
      availability: 'available',
      role: await this.roleForNewcomer(),
      weight: 1,
      outstandingReviews: 0,
      createdAt: this.container.clock.now(),
    })
  }

  /**
   * THE FIRST PERSON INTO AN ORG IS ITS ADMIN, and everybody after them is a
   * member.
   *
   * There is no other honest rule. An org is created by an operator who does not
   * thereby become a person in it (see `OrgService.create`), so if the first
   * sign-in produced a member, the tenancy would have a directory, a board and a
   * Configuration screen nobody on this deployment could open — and no route
   * that could fix it, because promoting somebody is itself an admin's act.
   *
   * It reads the directory rather than a flag on the org, so it stays true of
   * the default org too: a deployment upgrading into the boundary has reviewers
   * already, its migration made them admins, and the next sign-in is correctly
   * a member.
   *
   * Two first sign-ins racing both see an empty directory and both become
   * admins. That is the safe direction of the two, and it is bounded: it can
   * only happen while the org has nobody in it at all.
   */
  private async roleForNewcomer(): Promise<Role> {
    const directory = await this.container.repositories.reviewers.list()
    return directory.length === 0 ? 'admin' : 'member'
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
