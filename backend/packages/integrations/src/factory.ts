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
import { SlackChatGateway } from './slack/SlackChatGateway.js'

/**
 * The one implementation of `GatewayFactory`, shared by every runtime facade.
 *
 * It is here rather than in each facade because the facades must stay SYMMETRIC:
 * which adapter a credential builds, and which options it is built with, is the
 * same decision on the Worker and on the Node service, and a capability wired on
 * one and not the other is the failure mode this layout exists to prevent. What
 * differs between the facades is where the CONFIGURATION comes from (bindings on
 * one, `process.env` on the other), and that is all each of them still does.
 *
 * cat-factory arrives as a CLOSURE rather than as configuration, because
 * `@sainte-beuve/ai-review` is the only package that knows cat-factory exists and
 * this one has no business importing it. Each facade passes three lines; the
 * GitHub and Slack halves are shared.
 */
export interface GatewayFactoryConfig {
  /** GitHub REST base, for GitHub Enterprise Server. Defaults to api.github.com. */
  githubApiBaseUrl?: string
  /** The GitHub App this deployment authenticates as, when it has one. */
  githubApp: { appId: string; privateKeyPem: string } | null
  /** The OAuth client behind "Sign in with GitHub", when one is configured. */
  githubOAuth: { clientId: string; clientSecret: string; scope?: string } | null
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
  const { githubApiBaseUrl: baseUrl, fetchImpl } = config
  return {
    chat: (botToken) =>
      new SlackChatGateway({ botToken, appBaseUrl: config.appBaseUrl, fetch: fetchImpl }),
    vcsFromToken: (token) =>
      new GitHubVcsGateway({ tokens: staticTokenSource(token), baseUrl, fetchImpl }),
    vcsAsApp: vcsAsApp(config),
    aiReview: config.aiReview,
    githubSignIn: githubSignIn(config),
  }
}

function vcsAsApp(config: GatewayFactoryConfig): VcsGateway | null {
  if (config.githubApp === null) return null
  // Built ONCE, and held on the factory: the App auth memoises the imported RSA
  // key and every installation token it mints, which is the difference between
  // one signature per hour and one per repository call.
  const auth = new GitHubAppAuth({
    appId: config.githubApp.appId,
    privateKeyPem: config.githubApp.privateKeyPem,
    baseUrl: config.githubApiBaseUrl,
    clock: config.clock,
    fetchImpl: config.fetchImpl,
  })
  return new GitHubVcsGateway({
    tokens: appTokenSource(auth),
    baseUrl: config.githubApiBaseUrl,
    fetchImpl: config.fetchImpl,
  })
}

function githubSignIn(config: GatewayFactoryConfig): VcsIdentityGateway | null {
  if (config.githubOAuth === null) return null
  return new GitHubIdentityGateway({
    ...config.githubOAuth,
    apiBaseUrl: config.githubApiBaseUrl,
    fetchImpl: config.fetchImpl,
  })
}
