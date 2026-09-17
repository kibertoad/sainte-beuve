import type {
  Connections,
  VcsAuthMethod,
  VcsConnection,
  VcsProvider,
} from '@sainte-beuve/contracts'
import {
  DEFAULT_ORG_ID,
  DEFAULT_ORG_SLUG,
  signInCallbackPath,
  VCS_PROVIDERS,
  vcsDisplayName,
  vcsOauthCredentialKey,
  vcsPatCredentialKey,
} from '@sainte-beuve/contracts'
import type { RoundTripState } from '@sainte-beuve/kernel'
import { NotFoundError } from '@sainte-beuve/kernel'
import { type AppContainer, withOrg } from '../../container.js'
import { STATE_LIFETIME_MS } from '../../crypto/HmacStateSigner.js'
import { mintNonce } from '../../crypto/tokens.js'
import { requireCapability } from '../../http/errors.js'
import { resolveChat, resolveVcs } from '../../integrations/resolve.js'
import { notOurState, startedByThisBrowser } from './roundTrip.js'
import { establishSession, type IssuedSession, storeCredential } from './signIn.js'

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

/**
 * The two things a sign-in through one host's callback can be FOR.
 *
 * `connect` is an operator's act on shared state: it stores the credential the
 * whole deployment then works through. `session` proves who the caller is and
 * stores nothing. They share an OAuth client and a callback path because a host
 * matches the redirect URI it registered, and they are separate FLOWS because
 * the state is what says which of the two came back: one button that did both
 * would mean everybody who signed in overwrote the repository credential the
 * board runs on.
 */
export type SignInPurpose = 'connect' | 'session'

/** Names the flow a signed state belongs to, so one callback cannot accept another's. */
function signInFlow(provider: VcsProvider, purpose: SignInPurpose): string {
  return purpose === 'connect' ? `${provider}-sign-in` : `${provider}-session`
}

/** The two purposes, in the order the callback tries them. */
const SIGN_IN_PURPOSES: readonly SignInPurpose[] = ['connect', 'session']

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

/**
 * A round trip that has been started: where to send the browser, and the value
 * that says the browser coming back is this one.
 *
 * The nonce leaves this service rather than being written from inside it,
 * because a cookie is a RESPONSE and a service does not have one. The controller
 * that hands the URL to the browser is the one that hands it the cookie, in the
 * same answer. See `writeFlowCookie`.
 */
export interface StartedFlow {
  url: string
  nonce: string
}

/** What the callback learned, and what it now has to do with it. */
export interface CompletedSignIn {
  login: string
  returnTo: string | null
  session: IssuedSession
  purpose: SignInPurpose
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
  async appInstallUrl(): Promise<StartedFlow> {
    const slug = requireCapability(this.container.github.appSlug, NO_APP)
    const { state, nonce } = await this.mintState(APP_INSTALL_FLOW)
    const url = new URL(`/apps/${slug}/installations/new`, 'https://github.com')
    url.searchParams.set('state', state)
    return { url: url.toString(), nonce }
  }

  /**
   * Where to sign in. `origin` is the API's OWN origin, taken from the incoming
   * request rather than from configuration: the host matches the redirect URI
   * against what the OAuth app registered, and deriving it from the request is
   * what lets one build serve `http://localhost:8788` and a hosted origin without
   * a second variable to keep in step.
   */
  async signInUrl(
    provider: VcsProvider,
    origin: string,
    purpose: SignInPurpose = 'connect',
    /**
     * Which tenancy to sign in to, by slug. Omitted means the org this request
     * is already in, which for an anonymous caller is the default one — and is
     * every request on a deployment that never made a second org.
     */
    orgSlug?: string,
  ): Promise<StartedFlow> {
    const identity = requireCapability(
      this.container.gateways?.signIn(provider) ?? null,
      noOAuth(provider),
    )
    // A session sign-in lands back on the workspace and a connect lands on the
    // Configuration screen, because those are the pages the two were started
    // from and a round trip that dumps somebody somewhere else reads as a
    // failure even when it worked.
    const { state, nonce } = await this.mintState(
      signInFlow(provider, purpose),
      purpose === 'connect' ? '/configuration' : '/',
      await this.orgIdFor(orgSlug),
    )
    return {
      url: identity.authorizeUrl({ redirectUri: callbackUrl(provider, origin), state }),
      nonce,
    }
  }

  /** The hosts a sign-in can actually be started on. See `authStateSchema`. */
  signInProviders(): VcsProvider[] {
    if (this.container.states === null) return []
    return VCS_PROVIDERS.filter((provider) => this.container.gateways?.signIn(provider) != null)
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
    /** What the browser carried back in its flow cookie. See `RoundTripState`. */
    nonce: string | null
  }): Promise<CompletedSignIn> {
    const { provider } = input
    const { claims, purpose } = await this.verifySignInState(input.state, provider, input.nonce)
    const identity = requireCapability(
      this.container.gateways?.signIn(provider) ?? null,
      noOAuth(provider),
    )
    const { token, account } = await identity.exchangeCode({
      code: input.code,
      redirectUri: callbackUrl(provider, input.origin),
    })
    // EVERY WRITE BELOW GOES INTO THE ORG THE STATE NAMED, not the one this
    // callback arrived in: the callback carries no session, so the request is in
    // the default org, and the signed state is the only thing that knows which
    // tenancy the browser set out to join.
    const inOrg = withOrg(this.container, claims.orgId)
    if (purpose === 'connect') await storeCredential(inOrg, provider, token, account)
    return {
      login: account.username,
      returnTo: claims.returnTo,
      // BOTH purposes establish a session, because both of them proved the same
      // thing. An operator who just connected this deployment's credential has
      // demonstrated exactly what a sign-in demonstrates, and making them click
      // a second button to be recognised would be a round trip for nothing.
      session: await establishSession(inOrg, provider, account),
      purpose,
    }
  }

  /**
   * The org a slug names, or the one this request is already in.
   *
   * A slug nobody has made is a 404 rather than a quiet fall back to the default
   * org: somebody who typed an org name and was signed in to a different board
   * would have no way to tell, and the two states look identical afterwards.
   */
  private async orgIdFor(slug: string | undefined): Promise<string> {
    if (slug === undefined) return this.container.orgId
    // The DEFAULT org answers to its slug whether or not its row exists, which
    // is the ordinary state of a deployment that never made a second one (see
    // `OrgService.current`). Without this, the one slug every caller can read
    // off their own auth state — and the only one nobody is allowed to create —
    // is the one slug a sign-in refuses.
    if (slug === DEFAULT_ORG_SLUG) return DEFAULT_ORG_ID
    const held = await this.container.stores.orgs.getBySlug(slug)
    if (held === null) throw new NotFoundError(`No org "${slug}" on this deployment.`)
    return held.id
  }

  /**
   * Seal the exchanged token as this deployment's credential for the host.
   *
   * Only the `connect` purpose reaches this. The cipher is required HERE rather
   * than at the top of the flow, so a session sign-in on a deployment with no
   * encryption key is not refused for a capability it does not use — though in
   * practice it has one, because the state it carried had to be signed.
   */
  /**
   * The person behind the account, and a session for them.
   *
   * `PeopleService` rather than a row written here: the claim rule that stops a
   * directory forking into two people for one human being has to be the same one
   * the viewer read uses, and a second copy of it is how they come to disagree.
   */

  /**
   * Finish an App install. There is nothing to store: an installation is resolved
   * from the repository it is used for, so the App becomes usable the moment
   * GitHub says it is installed. What this DOES do is refuse a callback nobody
   * here started, so an install cannot be attributed to this deployment by
   * anybody who can construct a URL.
   */
  async completeAppInstall(
    state: string | null,
    nonce: string | null,
  ): Promise<{ returnTo: string | null }> {
    return { returnTo: (await this.verifyState(state, APP_INSTALL_FLOW, nonce)).returnTo }
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

  private async mintState(
    flow: string,
    returnPath = '/configuration',
    orgId: string = this.container.orgId,
  ): Promise<{ state: string; nonce: string }> {
    const signer = requireCapability(this.container.states, NO_STATE)
    const { appBaseUrl, clock } = this.container
    const nonce = mintNonce()
    return {
      state: await signer.sign({
        flow,
        nonce,
        orgId,
        // Back to the page the flow was started from, when the deployment said
        // where the SPA is.
        returnTo: appBaseUrl === null ? null : `${appBaseUrl}${returnPath}`,
        exp: clock.now() + STATE_LIFETIME_MS,
      }),
      nonce,
    }
  }

  /**
   * Which of this callback's own two flows came back, and its claims.
   *
   * Trying both is not the hole the flow check exists to close: that one is
   * about a state minted for the App install being presented to a sign-in, and
   * these two are the same callback's. What the check still buys is that a state
   * minted for a session sign-in cannot store the deployment's credential, which
   * is the difference that matters between them.
   */
  private async verifySignInState(
    value: string | null,
    provider: VcsProvider,
    nonce: string | null,
  ): Promise<{ claims: RoundTripState; purpose: SignInPurpose }> {
    const signer = requireCapability(this.container.states, NO_STATE)
    for (const purpose of SIGN_IN_PURPOSES) {
      const claims = await signer.verify(value, signInFlow(provider, purpose))
      if (claims !== null) return { claims: startedByThisBrowser(claims, nonce), purpose }
    }
    throw notOurState()
  }

  private async verifyState(
    value: string | null,
    flow: string,
    nonce: string | null,
  ): Promise<RoundTripState> {
    const signer = requireCapability(this.container.states, NO_STATE)
    const claims = await signer.verify(value, flow)
    if (claims === null) throw notOurState()
    return startedByThisBrowser(claims, nonce)
  }
}

function callbackUrl(provider: VcsProvider, origin: string): string {
  return new URL(signInCallbackPath(provider), origin).toString()
}
