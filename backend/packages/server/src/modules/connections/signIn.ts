import type { VcsProvider } from '@sainte-beuve/contracts'
import { vcsOauthCredentialKey } from '@sainte-beuve/contracts'
import type { VcsAccount } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { requireCapability } from '../../http/errors.js'
import { hintOf } from '../../integrations/credentials.js'
import { SessionService } from '../auth/SessionService.js'
import { PeopleService } from '../identity/PeopleService.js'

/**
 * The two writes a finished sign-in makes.
 *
 * FUNCTIONS TAKING A CONTAINER rather than methods on `ConnectionsService`, and
 * that is the whole reason they are a module of their own. The container they
 * write through is NOT the one the service was constructed with: a callback
 * carries no session, so the request is in the default org, and the org the
 * browser set out to join is only in the SIGNED STATE. A method reading
 * `this.container` would seal the credential and claim the person into whichever
 * tenancy the callback happened to arrive in.
 */

const NO_STATE =
  'Connecting an integration needs an encryption key, because the round trip has to be signed ' +
  'and the credential it returns has to be sealed: set SETTINGS_ENCRYPTION_KEY'

/** A session the callback has to hand to the browser. See `writeSessionCookie`. */
export interface IssuedSession {
  token: string
  expiresAt: number
}

/**
 * Seal the exchanged token as this org's credential for the host.
 *
 * Only the `connect` purpose reaches this. The cipher is required HERE rather
 * than at the top of the flow, so a session sign-in on a deployment with no
 * encryption key is not refused for a capability it does not use — though in
 * practice it has one, because the state it carried had to be signed.
 */
export async function storeCredential(
  container: AppContainer,
  provider: VcsProvider,
  token: string,
  account: VcsAccount,
): Promise<void> {
  const cipher = requireCapability(container.secrets, NO_STATE)
  const key = vcsOauthCredentialKey(provider)
  await container.repositories.integrationTokens.put({
    integrationId: key,
    sealed: await cipher.encrypt(token, key),
    hint: hintOf(token),
    subject: account.username,
    updatedAt: container.clock.now(),
  })
}

/**
 * The person behind the account, and a session for them, in the org the state
 * named.
 *
 * `PeopleService` rather than a row written here: the claim rule that stops a
 * directory forking into two people for one human being has to be the same one
 * the viewer read uses, and a second copy of it is how they come to disagree.
 */
export async function establishSession(
  container: AppContainer,
  provider: VcsProvider,
  account: VcsAccount,
): Promise<IssuedSession> {
  const reviewer = await new PeopleService(container).reviewerFor(provider, account)
  const { token, session } = await new SessionService(container).issue({
    reviewerId: reviewer.id,
    provider,
    subject: account.subject,
  })
  return { token, expiresAt: session.expiresAt }
}
