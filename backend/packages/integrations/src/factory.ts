import type { VcsProvider } from '@sainte-beuve/contracts'
import type {
  AiReviewGateway,
  Clock,
  GatewayFactory,
  VcsGateway,
  VcsIdentityGateway,
} from '@sainte-beuve/kernel'
import { GitHubAppAuth } from './github/GitHubAppAuth.js'
import { GitHubIdentityGateway } from './github/GitHubIdentityGateway.js'
import { GitHubVcsGateway } from './github/GitHubVcsGateway.js'
import { appTokenSource, staticTokenSource } from './github/credentials.js'
import { GitLabIdentityGateway } from './gitlab/GitLabIdentityGateway.js'
import { GitLabVcsGateway } from './gitlab/GitLabVcsGateway.js'
import { SlackChatGateway } from './slack/SlackChatGateway.js'

/**
 * The one implementation of `GatewayFactory`, shared by every runtime facade:
 * the facade that turns "this host, this credential" into an adapter.
 *
 * It is here rather than in each runtime because the runtimes must stay
 * SYMMETRIC: which adapter a credential builds, and which options it is built
 * with, is the same decision on the Worker and on the Node service, and a
 * capability wired on one and not the other is the failure mode this layout
 * exists to prevent. What differs between the facades is where the
 * CONFIGURATION comes from (bindings on one, `process.env` on the other), and
 * that is all each of them still does.
 *
 * Adding a third host is one entry per table below plus its adapter directory.
 * Nothing above this file learns about it: every caller asks for a provider and
 * gets a `VcsGateway` or a null it already had to handle.
 *
 * cat-factory arrives as a CLOSURE rather than as configuration, because
 * `@sainte-beuve/ai-review` is the only package that knows cat-factory exists
 * and this one has no business importing it.
 */

/**
 * How long a gateway built from a stored credential is kept, and how many are
 * kept at once. See {@link tokenGateways}.
 */
const GATEWAY_TTL_MS = 5 * 60_000
const MAX_KEPT_GATEWAYS = 16

/** An OAuth client, in the shape both hosts' sign-in flows take. */
export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  scope?: string
}

export interface GitHubFactoryConfig {
  /** REST base, for GitHub Enterprise Server. Defaults to api.github.com. */
  apiBaseUrl?: string
  /** The GitHub App this deployment authenticates as, when it has one. */
  app: { appId: string; privateKeyPem: string } | null
  oauth: OAuthClientConfig | null
}

export interface GitLabFactoryConfig {
  /** The install's root, serving the API and the OAuth endpoints. Defaults to gitlab.com. */
  baseUrl?: string
  oauth: OAuthClientConfig | null
}

export interface GatewayFactoryConfig {
  github: GitHubFactoryConfig
  gitlab: GitLabFactoryConfig
  /** Base URL of the SPA, so a chat message can link back to a review. */
  appBaseUrl?: string
  /**
   * Builds the AI reviewer from an API key, or answers null when the rest of
   * cat-factory's configuration (base URL, service id) is missing.
   */
  aiReview: (apiKey: string) => AiReviewGateway | null
  clock?: Clock
  /** Swap the HTTP implementation. Only a test has a reason to. */
  fetchImpl?: typeof globalThis.fetch
}

export function createGatewayFactory(config: GatewayFactoryConfig): GatewayFactory {
  // Built ONCE and closed over, not per call. The App path memoises an imported
  // RSA key and every installation token it mints, which is the difference
  // between one signature an hour and one per repository call; the sign-in
  // gateways are cheap but there is no reason to rebuild them either.
  const asApp: Record<VcsProvider, VcsGateway | null> = {
    github: githubAsApp(config),
    // GitLab has no App concept: a group access token is a pasted token like
    // any other, so there is nothing for a deployment to authenticate AS.
    gitlab: null,
  }
  const signIn: Record<VcsProvider, VcsIdentityGateway | null> = {
    github: githubSignIn(config),
    gitlab: gitlabSignIn(config),
  }
  const fromToken = tokenGateways(config)
  return {
    chat: (botToken) =>
      new SlackChatGateway({
        botToken,
        appBaseUrl: config.appBaseUrl,
        fetch: config.fetchImpl,
      }),
    vcsFromToken: fromToken,
    vcsAsApp: (provider) => asApp[provider],
    aiReview: config.aiReview,
    signIn: (provider) => signIn[provider],
  }
}

/**
 * Gateways built from a credential somebody stored, kept a few minutes per
 * `(host, credential)`.
 *
 * The adapters memoise `identify()` for the life of the instance and resolution
 * runs per request, so a fresh instance per call spends a `GET /user` on every
 * workspace read, inbox poll and stream open to be told the same thing. The
 * credential is part of the key, so a rotated token builds a new gateway
 * instead of answering out of the old one's cache.
 *
 * Kept for MINUTES rather than for the life of the isolate: a handle is
 * renameable, and an instance that outlived the rename would keep mirroring
 * assignments onto a name the host no longer routes. Bounded for the same
 * reason a map keyed on credentials always should be.
 */
function tokenGateways(
  config: GatewayFactoryConfig,
): (provider: VcsProvider, token: string) => VcsGateway {
  const kept = new Map<string, { builtAt: number; gateway: VcsGateway }>()
  const now = (): number => config.clock?.now() ?? Date.now()
  return (provider, token) => {
    const key = JSON.stringify([provider, token])
    const held = kept.get(key)
    if (held !== undefined && now() - held.builtAt < GATEWAY_TTL_MS) return held.gateway
    // Re-inserted rather than overwritten, so the map's order is least recently
    // built first and the eviction below drops that one.
    kept.delete(key)
    const oldest = kept.size < MAX_KEPT_GATEWAYS ? undefined : kept.keys().next().value
    if (oldest !== undefined) kept.delete(oldest)
    const gateway = vcsFromToken(config, provider, token)
    kept.set(key, { builtAt: now(), gateway })
    return gateway
  }
}

function vcsFromToken(
  config: GatewayFactoryConfig,
  provider: VcsProvider,
  token: string,
): VcsGateway {
  if (provider === 'gitlab') {
    return new GitLabVcsGateway({
      token,
      baseUrl: config.gitlab.baseUrl,
      fetchImpl: config.fetchImpl,
    })
  }
  return new GitHubVcsGateway({
    tokens: staticTokenSource(token),
    baseUrl: config.github.apiBaseUrl,
    fetchImpl: config.fetchImpl,
  })
}

function githubAsApp(config: GatewayFactoryConfig): VcsGateway | null {
  const app = config.github.app
  if (app === null) return null
  const auth = new GitHubAppAuth({
    appId: app.appId,
    privateKeyPem: app.privateKeyPem,
    baseUrl: config.github.apiBaseUrl,
    clock: config.clock,
    fetchImpl: config.fetchImpl,
  })
  return new GitHubVcsGateway({
    tokens: appTokenSource(auth),
    baseUrl: config.github.apiBaseUrl,
    fetchImpl: config.fetchImpl,
  })
}

function githubSignIn(config: GatewayFactoryConfig): VcsIdentityGateway | null {
  const oauth = config.github.oauth
  if (oauth === null) return null
  return new GitHubIdentityGateway({
    ...oauth,
    apiBaseUrl: config.github.apiBaseUrl,
    fetchImpl: config.fetchImpl,
  })
}

function gitlabSignIn(config: GatewayFactoryConfig): VcsIdentityGateway | null {
  const oauth = config.gitlab.oauth
  if (oauth === null) return null
  return new GitLabIdentityGateway({
    ...oauth,
    baseUrl: config.gitlab.baseUrl,
    fetchImpl: config.fetchImpl,
  })
}
