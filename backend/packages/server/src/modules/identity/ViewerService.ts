import type { Reviewer, VcsProvider, Viewer } from '@sainte-beuve/contracts'
import { VCS_PROVIDERS } from '@sainte-beuve/contracts'
import { assertFound, UnavailableError, type VcsAccount } from '@sainte-beuve/kernel'
import type { Input } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { VcsResolutions } from '../../integrations/resolve.js'
import {
  type AnyAppContext,
  principalOf,
  type RequestPrincipal,
  refuseIfMachine,
} from '../auth/principal.js'
import { PeopleService } from './PeopleService.js'

/**
 * Who the workspace is being rendered for.
 *
 * A SESSION is the answer whenever there is one: the session names a reviewer
 * row and a host account, both already in the store, so the viewer read touches
 * no gateway at all. That is the substitution slice 6 was written around, and it
 * is what makes a shared deployment correct — before it, everybody's workspace
 * rendered for whoever the deployment's own source-control token acted as.
 *
 * The CREDENTIAL remains the answer for a deployment running `open` with nobody
 * signed in, which is local mode and every deployment that has not turned
 * sessions on. Keeping it is not a hedge: it is what lets a laptop run the whole
 * product with a pasted token and no OAuth client, and it is reached only where
 * the deployment has said anonymous callers are welcome.
 *
 * An API key is refused rather than resolved. A key is nobody, so it has no
 * three lists, and inventing a person for it would put somebody else's work on a
 * CI job's screen.
 */

const NO_IDENTITY =
  'This deployment cannot tell who you are: sign in, or connect a source-control account on the ' +
  'Configuration screen (Sign in with GitHub, or paste a personal access token). A GitHub App ' +
  'installation is not a person, so it cannot be the viewer.'

export class ViewerService {
  /**
   * The resolutions are handed IN by a caller that already needs a host of its
   * own (the workspace read needs GitHub twice: once for the viewer, once for
   * the sweep), so the sealed credential is opened once for the request rather
   * than once per question asked of it.
   */
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
    private readonly resolutions: VcsResolutions = new VcsResolutions(container),
  ) {}

  /** The person in front of the workspace, creating their row on first sight. */
  async current(): Promise<Viewer> {
    refuseIfMachine(this.principal)
    const reviewer =
      this.principal.kind === 'session'
        ? await this.reviewerOfSession(this.principal.session.reviewerId)
        : await this.reviewerOfCredential()
    return {
      reviewer,
      identities: await this.container.repositories.identities.listForReviewer(reviewer.id),
    }
  }

  /**
   * The row a live session points at.
   *
   * A session whose reviewer has been deleted cannot happen through any route
   * here (the directory has no delete; `paused` is the way out), so this is
   * `assertFound` rather than a fallback: a 404 naming the row is a bug report,
   * and silently re-claiming a person would paper over it by inventing a second.
   */
  private async reviewerOfSession(reviewerId: string): Promise<Reviewer> {
    return assertFound(
      await this.container.repositories.reviewers.getById(reviewerId),
      `No reviewer ${reviewerId}`,
    )
  }

  /** Whoever the deployment's own credential acts as. The `open`, signed-out path. */
  private async reviewerOfCredential(): Promise<Reviewer> {
    const { provider, account } = await this.signedInAccount()
    return new PeopleService(this.container).reviewerFor(provider, account)
  }

  /**
   * The account behind whichever host this deployment can currently speak for.
   *
   * The hosts are tried in order and the first with a person behind its
   * credential wins. The credential asked for is the one that acts as a PERSON
   * (`asPerson`), which is what keeps an App installation from shadowing the
   * sign-in underneath it: the App identifies nobody, so a deployment holding
   * both would otherwise be viewed as nobody.
   */
  private async signedInAccount(): Promise<{ provider: VcsProvider; account: VcsAccount }> {
    for (const provider of VCS_PROVIDERS) {
      const resolved = await this.resolutions.asPerson(provider)
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
}

/**
 * The viewer for one request, from the two things the context already holds.
 *
 * Every route that renders for a person goes through this rather than
 * constructing the service, so none of them can forget to pass the caller and
 * silently fall back to the deployment's credential.
 */
export async function viewerOf<E extends AppEnv, P extends string, I extends Input>(
  c: AnyAppContext<E, P, I>,
): Promise<Viewer> {
  const container: AppContainer = c.get('container')
  return new ViewerService(container, principalOf(c)).current()
}
