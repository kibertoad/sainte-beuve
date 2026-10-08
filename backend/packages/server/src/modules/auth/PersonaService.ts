import type { IdentityProvider } from '@sainte-beuve/contracts'
import { assertFound, ForbiddenError, type StoredSession } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { ViewerService } from '../identity/ViewerService.js'
import { type RequestPrincipal, refuseIfMachine } from './principal.js'
import { SessionService } from './SessionService.js'

const DEV_MODE_OFF =
  'Acting as another person is a development tool, and this deployment does not run with ' +
  'DEV_MODE=true.'

const PAUSED =
  'This person is paused, and a paused person cannot be signed in to. Resume them on the ' +
  'Reviewers screen first.'

/**
 * Development mode's persona switch: a session for any row of the caller's
 * directory, without a sign-in.
 *
 * The session records the host account of whoever switched (their own session's,
 * or the deployment credential's on an anonymous `open` caller), because that is
 * the account that established it. Calls to the host keep going through the
 * deployment's credential either way; only the person the screens render for
 * changes.
 */
export class PersonaService {
  constructor(
    private readonly container: AppContainer,
    private readonly principal: RequestPrincipal,
  ) {}

  async actAs(reviewerId: string): Promise<{ token: string; session: StoredSession }> {
    if (!this.container.auth.devMode) throw new ForbiddenError(DEV_MODE_OFF)
    refuseIfMachine(this.principal)
    const reviewer = assertFound(
      await this.container.repositories.reviewers.getById(reviewerId),
      `No reviewer ${reviewerId}`,
    )
    if (reviewer.availability === 'paused') throw new ForbiddenError(PAUSED)
    const origin = await this.originAccount()
    const sessions = new SessionService(this.container)
    const issued = await sessions.issue({ reviewerId, ...origin })
    // The session being replaced is dropped, so switching back and forth does not
    // leave a row per switch behind. After the issue, so a failed one leaves the
    // caller signed in as before.
    if (this.principal.kind === 'session') await sessions.revoke(this.principal.session.id)
    this.container.logger.info({ reviewerId, ...origin }, 'dev mode: acting as a persona')
    return issued
  }

  private async originAccount(): Promise<{ provider: IdentityProvider; subject: string }> {
    if (this.principal.kind === 'session') {
      const { provider, subject } = this.principal.session
      return { provider, subject }
    }
    const { provider, account } = await new ViewerService(
      this.container,
      this.principal,
    ).signedInAccount()
    return { provider, subject: account.subject }
  }
}
