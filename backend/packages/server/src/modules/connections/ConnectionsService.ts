import type { Connections, GitHubAuthMethod, GitHubConnection } from '@sainte-beuve/contracts'
import { GITHUB_OAUTH_CREDENTIAL_KEY, GITHUB_SIGN_IN_CALLBACK_PATH } from '@sainte-beuve/contracts'
import { type RoundTripState, ValidationError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { STATE_LIFETIME_MS } from '../../crypto/HmacStateSigner.js'
import { requireCapability } from '../../http/errors.js'
import { hintOf } from '../../integrations/credentials.js'
import { resolveChat, resolveVcs } from '../../integrations/resolve.js'

/**
 * How this deployment reaches GitHub and Slack, and how an operator changes it.
 *
 * The read is one call because the questions it answers are one question:
 * "should I expect anything to work?" Which credential is in force, which ones
 * this deployment could offer instead, and whether an inbound delivery can be
 * verified are three halves of that, and a screen that had to assemble them from
 * three routes would report a state that never existed at any single moment.
 */

/** Names the flow a signed state belongs to, so one callback cannot accept another's. */
const SIGN_IN_FLOW = 'github-sign-in'
const APP_INSTALL_FLOW = 'github-app-install'

const NO_APP =
  'This deployment has no GitHub App to install: set GITHUB_APP_SLUG (with GITHUB_APP_ID and ' +
  'GITHUB_APP_PRIVATE_KEY) to offer one'
const NO_OAUTH =
  'Signing in with GitHub needs an OAuth client: set GITHUB_OAUTH_CLIENT_ID and ' +
  'GITHUB_OAUTH_CLIENT_SECRET on the deployment'
const NO_STATE =
  'Connecting an integration needs an encryption key, because the round trip has to be signed ' +
  'and the credential it returns has to be sealed: set SETTINGS_ENCRYPTION_KEY'

export class ConnectionsService {
  constructor(private readonly container: AppContainer) {}

  async read(): Promise<Connections> {
    const [github, chat] = await Promise.all([this.github(), resolveChat(this.container)])
    return {
      github,
      slack: {
        ready: chat !== null,
        announcementChannelId: this.container.slack.announcementChannelId,
        interactivityReady: this.container.slack.signingSecret !== null,
      },
    }
  }

  /**
   * Where to install the App. The signed state rides along so the setup callback
   * can refuse a return leg this deployment did not start.
   */
  async appInstallUrl(): Promise<string> {
    const slug = requireCapability(this.container.github.appSlug, NO_APP)
    const state = await this.mintState(APP_INSTALL_FLOW)
    const url = new URL(`/apps/${slug}/installations/new`, 'https://github.com')
    url.searchParams.set('state', state)
    return url.toString()
  }

  /**
   * Where to sign in. `origin` is the API's OWN origin, taken from the incoming
   * request rather than from configuration: GitHub matches the redirect URI
   * against what the OAuth app registered, and deriving it from the request is
   * what lets one build serve `http://localhost:8788` and a hosted origin without
   * a second variable to keep in step.
   */
  async signInUrl(origin: string): Promise<string> {
    const identity = requireCapability(this.container.gateways?.githubSignIn ?? null, NO_OAUTH)
    return identity.authorizeUrl({
      redirectUri: callbackUrl(origin),
      state: await this.mintState(SIGN_IN_FLOW),
    })
  }

  /**
   * Finish a sign-in: check that we started it, trade the code for a token, and
   * seal the token as this deployment's GitHub credential.
   *
   * The state is checked FIRST, before the code is spent and before the
   * deployment's own configuration is consulted. Two reasons, and the second is
   * why it is not merely tidier: the exchange is a side effect, so a code
   * presented by somebody else is a credential we would otherwise store on their
   * behalf; and this route is reached by whatever a browser was pointed at, so a
   * caller who did not start a flow here should learn nothing about how this
   * deployment is configured.
   */
  async completeSignIn(input: { code: string; state: string | null; origin: string }): Promise<{
    login: string
    returnTo: string | null
  }> {
    const claims = await this.verifyState(input.state, SIGN_IN_FLOW)
    const identity = requireCapability(this.container.gateways?.githubSignIn ?? null, NO_OAUTH)
    const cipher = requireCapability(this.container.secrets, NO_STATE)
    const { token, login } = await identity.exchangeCode({
      code: input.code,
      redirectUri: callbackUrl(input.origin),
    })
    await this.container.repositories.integrationTokens.put({
      integrationId: GITHUB_OAUTH_CREDENTIAL_KEY,
      sealed: await cipher.encrypt(token, GITHUB_OAUTH_CREDENTIAL_KEY),
      hint: hintOf(token),
      subject: login,
      updatedAt: this.container.clock.now(),
    })
    return { login, returnTo: claims.returnTo }
  }

  /**
   * Finish an App install. There is nothing to store: an installation is resolved
   * from the repository it is used for, so the App becomes usable the moment
   * GitHub says it is installed. What this DOES do is refuse a callback nobody
   * here started, so an install cannot be attributed to this deployment by
   * anybody who can construct a URL.
   */
  async completeAppInstall(state: string | null): Promise<{ returnTo: string | null }> {
    return { returnTo: (await this.verifyState(state, APP_INSTALL_FLOW)).returnTo }
  }

  /** Drop the sign-in credential. The App and the environment are untouched. */
  async signOut(): Promise<void> {
    await this.container.repositories.integrationTokens.delete(GITHUB_OAUTH_CREDENTIAL_KEY)
  }

  private async github(): Promise<GitHubConnection> {
    const active = await resolveVcs(this.container)
    // `appSlug` is deliberately not on the wire: the install URL is its own
    // route, so the screen never has to know how one is assembled.
    const { webhookSecret, botLogin, labels } = this.container.github
    return {
      activeMethod: active?.source ?? null,
      availableMethods: this.availableMethods(),
      account: await this.accountFor(active?.source ?? null),
      webhooksReady: webhookSecret !== null,
      botLogin,
      labels,
    }
  }

  private availableMethods(): GitHubAuthMethod[] {
    const factory = this.container.gateways
    const offered: [GitHubAuthMethod, boolean][] = [
      // The App needs a slug as well as a key: without one there is no page to
      // send an operator to, so offering it would be a button that cannot work.
      ['app', factory?.vcsAsApp != null && this.container.github.appSlug !== null],
      ['oauth', factory?.githubSignIn != null && this.container.secrets !== null],
      ['pat', this.container.secrets !== null],
      ['environment', this.container.vcs !== null],
    ]
    return offered.filter(([, available]) => available).map(([method]) => method)
  }

  /**
   * The account behind the active credential. Read off the stored row rather than
   * from GitHub: the login was captured when the credential was stored, and a
   * status screen that polls must not spend a GitHub request per poll to repeat
   * it. An App acts as itself rather than as a person, so it has none.
   */
  private async accountFor(method: GitHubAuthMethod | null): Promise<string | null> {
    if (method !== 'oauth' && method !== 'pat') return null
    const key = method === 'oauth' ? GITHUB_OAUTH_CREDENTIAL_KEY : 'github-pat'
    return (await this.container.repositories.integrationTokens.get(key))?.subject ?? null
  }

  private async mintState(flow: string): Promise<string> {
    const signer = requireCapability(this.container.states, NO_STATE)
    const { appBaseUrl, clock } = this.container
    return signer.sign({
      flow,
      // Back to the Configuration screen, when the deployment said where that is.
      returnTo: appBaseUrl === null ? null : `${appBaseUrl}/configuration`,
      exp: clock.now() + STATE_LIFETIME_MS,
    })
  }

  private async verifyState(value: string | null, flow: string): Promise<RoundTripState> {
    const signer = requireCapability(this.container.states, NO_STATE)
    const claims = await signer.verify(value, flow)
    if (claims === null) {
      // A validation error, not a forbidden one: the overwhelmingly common cause
      // is an operator finishing an install they started an hour ago, and the
      // message has to say "start again" rather than accuse them of anything.
      throw new ValidationError(
        'This GitHub callback did not carry a state this deployment recently issued. Start the ' +
          'connection again from the Configuration screen.',
      )
    }
    return claims
  }
}

function callbackUrl(origin: string): string {
  return new URL(GITHUB_SIGN_IN_CALLBACK_PATH, origin).toString()
}
