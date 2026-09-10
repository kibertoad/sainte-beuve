import type {
  Connections,
  VcsAuthMethod,
  VcsConnection,
  VcsProvider,
} from '@sainte-beuve/contracts'
import {
  signInCallbackPath,
  VCS_PROVIDERS,
  vcsDisplayName,
  vcsOauthCredentialKey,
  vcsPatCredentialKey,
} from '@sainte-beuve/contracts'
import { type RoundTripState, ValidationError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../../container.js'
import { STATE_LIFETIME_MS } from '../../crypto/HmacStateSigner.js'
import { requireCapability } from '../../http/errors.js'
import { hintOf } from '../../integrations/credentials.js'
import { resolveChat, resolveVcs } from '../../integrations/resolve.js'

/**
 * How this deployment reaches its source-control hosts and Slack, and how an
 * operator changes it.
 *
 * The read is one call because the questions it answers are one question:
 * "should I expect anything to work?" Which credential is in force, which ones
 * this deployment could offer instead, and whether an inbound delivery can be
 * verified are three halves of that, and a screen that had to assemble them from
 * three routes would report a state that never existed at any single moment.
 *
 * Every host goes through the same path. Which one a route is about is an
 * argument, not a branch: the flow name, the callback path, the credential key
 * and the gateway are all derived from the provider, so adding a third host
 * adds no code here.
 */

/** Names the flow a signed state belongs to, so one callback cannot accept another's. */
function signInFlow(provider: VcsProvider): string {
  return `${provider}-sign-in`
}

const APP_INSTALL_FLOW = 'github-app-install'

const NO_APP =
  'This deployment has no GitHub App to install: set GITHUB_APP_SLUG (with GITHUB_APP_ID and ' +
  'GITHUB_APP_PRIVATE_KEY) to offer one'
const NO_STATE =
  'Connecting an integration needs an encryption key, because the round trip has to be signed ' +
  'and the credential it returns has to be sealed: set SETTINGS_ENCRYPTION_KEY'

/** The variables a host's OAuth client is configured under, for the refusal to name. */
const OAUTH_VARIABLES: Record<VcsProvider, string> = {
  github: 'GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET',
  gitlab: 'GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET',
}

function noOAuth(provider: VcsProvider): string {
  return (
    `Signing in to ${vcsDisplayName(provider)} needs an OAuth client: ` +
    `set ${OAUTH_VARIABLES[provider]} on the deployment`
  )
}

export class ConnectionsService {
  constructor(private readonly container: AppContainer) {}

  async read(): Promise<Connections> {
    const [vcs, chat] = await Promise.all([
      Promise.all(VCS_PROVIDERS.map((provider) => this.connection(provider))),
      resolveChat(this.container),
    ])
    return {
      vcs,
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
   * request rather than from configuration: the host matches the redirect URI
   * against what the OAuth app registered, and deriving it from the request is
   * what lets one build serve `http://localhost:8788` and a hosted origin without
   * a second variable to keep in step.
   */
  async signInUrl(provider: VcsProvider, origin: string): Promise<string> {
    const identity = requireCapability(
      this.container.gateways?.signIn(provider) ?? null,
      noOAuth(provider),
    )
    return identity.authorizeUrl({
      redirectUri: callbackUrl(provider, origin),
      state: await this.mintState(signInFlow(provider)),
    })
  }

  /**
   * Finish a sign-in: check that we started it, trade the code for a token, and
   * seal the token as this deployment's credential for that host.
   *
   * The state is checked FIRST, before the code is spent and before the
   * deployment's own configuration is consulted. Two reasons, and the second is
   * why it is not merely tidier: the exchange is a side effect, so a code
   * presented by somebody else is a credential we would otherwise store on their
   * behalf; and this route is reached by whatever a browser was pointed at, so a
   * caller who did not start a flow here should learn nothing about how this
   * deployment is configured.
   */
  async completeSignIn(input: {
    provider: VcsProvider
    code: string
    state: string | null
    origin: string
  }): Promise<{ login: string; returnTo: string | null }> {
    const { provider } = input
    const claims = await this.verifyState(input.state, signInFlow(provider))
    const identity = requireCapability(
      this.container.gateways?.signIn(provider) ?? null,
      noOAuth(provider),
    )
    const cipher = requireCapability(this.container.secrets, NO_STATE)
    const key = vcsOauthCredentialKey(provider)
    const { token, account } = await identity.exchangeCode({
      code: input.code,
      redirectUri: callbackUrl(provider, input.origin),
    })
    await this.container.repositories.integrationTokens.put({
      integrationId: key,
      sealed: await cipher.encrypt(token, key),
      hint: hintOf(token),
      subject: account.username,
      updatedAt: this.container.clock.now(),
    })
    return { login: account.username, returnTo: claims.returnTo }
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

  /** Drop one host's sign-in credential. The App and the environment are untouched. */
  async signOut(provider: VcsProvider): Promise<void> {
    await this.container.repositories.integrationTokens.delete(vcsOauthCredentialKey(provider))
  }

  private async connection(provider: VcsProvider): Promise<VcsConnection> {
    const active = await resolveVcs(this.container, provider)
    // `appSlug` is deliberately not on the wire: the install URL is its own
    // route, so the screen never has to know how one is assembled.
    const { webhookSecret, botLogin, labels } = this.container.github
    return {
      provider,
      activeMethod: active?.source ?? null,
      availableMethods: this.availableMethods(provider),
      appInstallable: this.appInstallable(provider),
      account: await this.accountFor(provider, active?.source ?? null),
      // Inbound deliveries are a GitHub intake today; a GitLab webhook is its
      // own slice, and reporting the GitHub secret against it would claim a
      // capability that does not exist.
      inboundIntake: provider === 'github',
      webhooksReady: provider === 'github' && webhookSecret !== null,
      botLogin: provider === 'github' ? botLogin : null,
      labels,
    }
  }

  private availableMethods(provider: VcsProvider): VcsAuthMethod[] {
    const factory = this.container.gateways
    const offered: [VcsAuthMethod, boolean][] = [
      // An App id and key alone: `resolveVcs` authenticates with those, so this
      // list has to hold `app` on exactly the deployments where the App can win.
      // The SLUG decides whether an install can be OFFERED, which is
      // `appInstallable` and a different question.
      ['app', factory?.vcsAsApp(provider) != null],
      ['oauth', factory?.signIn(provider) != null && this.container.secrets !== null],
      ['pat', this.container.secrets !== null],
      ['environment', this.container.vcs[provider] !== null],
    ]
    return offered.filter(([, available]) => available).map(([method]) => method)
  }

  /** An install needs a page to send an operator to, and the slug addresses it. */
  private appInstallable(provider: VcsProvider): boolean {
    if (provider !== 'github') return false
    return (
      this.container.gateways?.vcsAsApp('github') != null && this.container.github.appSlug !== null
    )
  }

  /**
   * The account behind the active credential. Read off the stored row rather than
   * from the host: the handle was captured when the credential was stored, and a
   * status screen that polls must not spend a request per poll to repeat it. An
   * App acts as itself rather than as a person, so it has none.
   */
  private async accountFor(
    provider: VcsProvider,
    method: VcsAuthMethod | null,
  ): Promise<string | null> {
    if (method !== 'oauth' && method !== 'pat') return null
    const key = method === 'oauth' ? vcsOauthCredentialKey(provider) : vcsPatCredentialKey(provider)
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
        'This callback did not carry a state this deployment recently issued. Start the ' +
          'connection again from the Configuration screen.',
      )
    }
    return claims
  }
}

function callbackUrl(provider: VcsProvider, origin: string): string {
  return new URL(signInCallbackPath(provider), origin).toString()
}
