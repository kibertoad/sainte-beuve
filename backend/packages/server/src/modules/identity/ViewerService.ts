import type { LinkedIdentity, Reviewer, VcsProvider, Viewer } from '@sainte-beuve/contracts'
import { NO_VCS_HANDLES, VCS_PROVIDERS, withHandle } from '@sainte-beuve/contracts'
import { assertFound, UnavailableError, type VcsAccount } from '@sainte-beuve/kernel'
import { isSameHandle } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { resolveVcs } from '../../integrations/resolve.js'

/**
 * Who the workspace is being rendered for.
 *
 * There is no session yet (docs/implementation-plan.md, slice 6), so the viewer
 * is derived from the credential this deployment holds: whoever the
 * source-control token acts as is who is looking. That is honest for a
 * single-tenant deployment and it is exactly what slice 6 replaces, one layer
 * lower down, by handing this service a session subject instead of asking a
 * gateway.
 *
 * What it deliberately does NOT do is treat the handle as the identity. The
 * account's stable subject is the key, the handle is refreshed from it, and the
 * person behind it is a reviewer row. So a rename keeps somebody's workspace,
 * the next holder of the name does not inherit it, and one person can hold a
 * GitHub and a GitLab account at once.
 */

const NO_IDENTITY =
  'This deployment cannot tell who you are: connect a source-control account on the Configuration ' +
  'screen (Sign in with GitHub, or paste a personal access token). A GitHub App installation is ' +
  'not a person, so it cannot be the viewer.'

export class ViewerService {
  constructor(private readonly container: AppContainer) {}

  /** The person in front of the workspace, creating their row on first sight. */
  async current(): Promise<Viewer> {
    const { provider, account } = await this.signedInAccount()
    const reviewer = await this.reviewerFor(provider, account)
    return {
      reviewer,
      identities: await this.container.repositories.identities.listForReviewer(reviewer.id),
    }
  }

  /**
   * The account behind whichever host this deployment can currently speak for.
   *
   * The hosts are tried in order and the first with a person behind its
   * credential wins. An App installation token identifies nobody and is skipped
   * rather than refused, so a deployment with a GitHub App and a GitLab sign-in
   * is viewed as the GitLab account rather than as nobody.
   */
  private async signedInAccount(): Promise<{ provider: VcsProvider; account: VcsAccount }> {
    for (const provider of VCS_PROVIDERS) {
      const resolved = await resolveVcs(this.container, provider)
      if (resolved === null) continue
      const account = await this.identify(
        provider,
        resolved.gateway.identify.bind(resolved.gateway),
      )
      if (account !== null) return { provider, account }
    }
    throw new UnavailableError(NO_IDENTITY)
  }

  /**
   * A host that refuses the read is LOGGED and skipped, not thrown. An expired
   * GitLab token must not be able to hide a working GitHub sign-in, and the
   * refusal an operator has to act on is already on the Configuration screen.
   */
  private async identify(
    provider: VcsProvider,
    read: () => Promise<VcsAccount | null>,
  ): Promise<VcsAccount | null> {
    try {
      return await read()
    } catch (err) {
      this.container.logger.warn(
        { err, provider },
        'could not read the account behind a credential',
      )
      return null
    }
  }

  /**
   * The reviewer row behind one host account: the linked one, else an existing
   * directory row with the same handle, else a new person.
   *
   * The middle step is what stops the directory forking. A team registers
   * people by hand long before anybody signs in, and creating a second row for
   * the same human the first time they open the workspace would give them an
   * empty skill list and leave the router drawing the other row.
   */
  private async reviewerFor(provider: VcsProvider, account: VcsAccount): Promise<Reviewer> {
    const { repositories, clock } = this.container
    const linkedId = await repositories.identities.findReviewerId(provider, account.subject)
    if (linkedId !== null) return this.refresh(linkedId, provider, account)

    const adopted = (await repositories.reviewers.list()).find((reviewer) =>
      isSameHandle(reviewer.handles[provider], account.username),
    )
    const reviewer =
      adopted ??
      (await repositories.reviewers.create({
        id: this.container.ids.next(),
        displayName: account.displayName ?? account.username,
        handles: withHandle(NO_VCS_HANDLES, provider, account.username),
        slackUserId: null,
        team: null,
        skills: [],
        availability: 'available',
        weight: 1,
        outstandingReviews: 0,
        createdAt: clock.now(),
      }))
    await repositories.identities.link(reviewer.id, this.identityOf(provider, account))
    return reviewer
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
