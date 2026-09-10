import { CatFactoryAiReviewGateway } from '@sainte-beuve/ai-review'
import {
  createGatewayFactory,
  GitHubVcsGateway,
  GitLabVcsGateway,
  SlackChatGateway,
  staticTokenSource,
} from '@sainte-beuve/integrations'
import type { AiReviewGateway, ChatGateway, GatewayFactory, Logger } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import {
  type AppContainer,
  createContainer,
  DEFAULT_GITHUB_LABELS,
  type EnvironmentVcsGateways,
  InMemoryAttentionBus,
  type SecretsWiring,
  secretsFrom,
} from '@sainte-beuve/server'
import type { WorkerEnv } from './env.js'

/**
 * Build the container for one Worker isolate.
 *
 * The store is a MODULE-LEVEL in-memory one, which is wrong for production and
 * deliberately so: it makes the missing D1 adapter impossible to forget (an isolate
 * recycle loses the board) rather than quietly shipping something that looks
 * durable. Slice 5 replaces this with D1 and the line goes away. See
 * docs/implementation-plan.md.
 */
const repositories = createInMemoryRepositories()

/**
 * The attention fan-out, held per ISOLATE for the same reason the store is: the
 * container is rebuilt per request here, and a bus built with it would have one
 * subscriber and no publisher.
 *
 * What that buys on this runtime is honest and limited: an event reaches the
 * streams attached to THIS isolate and no other. The REST inbox
 * (`GET /api/v1/attention`) is what makes the feature correct everywhere, and it
 * carries the same payload. Cross-isolate delivery is a Durable Object behind
 * the same port, and it changes nothing above it.
 */
const bus = new InMemoryAttentionBus()

/** `console` is the Workers-native logger; Workers Logs picks up structured lines. */
const workerLogger: Logger = {
  debug: (obj, msg) => console.debug(msg ?? '', obj),
  info: (obj, msg) => console.info(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
}

/**
 * The two things on the container that are worth keeping ALIVE across requests,
 * cached per isolate.
 *
 * `containerFor` runs per request on this runtime (bindings only exist inside
 * one), and both of these memoise work that would otherwise be repeated on every
 * invocation of a runtime billed by CPU time: the cipher holds an imported HKDF
 * key and the key id it derives, and the gateway factory holds the App's
 * imported RSA key plus every installation token it has minted. A fresh instance
 * per request throws all of it away, and re-mints an installation token per
 * repository call instead of once an hour.
 *
 * The mistyped-key case is the louder half of the cipher's: its construction
 * failure logs, and a log line on every request (`/health` included) is a Workers
 * Logs flood.
 *
 * Both are keyed by the bindings they were built from, so a `wrangler secret put`
 * on a warm isolate still takes effect.
 */
let cachedSecrets: { key: string | undefined; wiring: SecretsWiring } | null = null
let cachedGateways: { key: string; factory: GatewayFactory } | null = null

function secretsFor(env: WorkerEnv): SecretsWiring {
  if (cachedSecrets === null || cachedSecrets.key !== env.SETTINGS_ENCRYPTION_KEY) {
    cachedSecrets = {
      key: env.SETTINGS_ENCRYPTION_KEY,
      wiring: secretsFrom({
        masterKeyBase64: env.SETTINGS_ENCRYPTION_KEY,
        logger: workerLogger,
      }),
    }
  }
  return cachedSecrets.wiring
}

/**
 * The credential-shaped bindings the factory is built from, as one string. The
 * cat-factory and Slack halves are in the key as well as GitHub's, because the
 * factory closes over the base URL and the service id too.
 *
 * `JSON.stringify` rather than `join`: a separator maps an unset binding and a
 * blank one onto the same segment, so a `wrangler secret put` that fills in a
 * blank would not rebuild the cached factory. It also keeps the key printable,
 * where a control character as the separator made git read this source file as
 * binary and hid every change to this facade from a diff.
 */
function gatewayKey(env: WorkerEnv): string {
  return JSON.stringify([
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_OAUTH_CLIENT_ID,
    env.GITHUB_OAUTH_CLIENT_SECRET,
    env.GITHUB_OAUTH_SCOPE,
    env.GITHUB_API_BASE_URL,
    env.GITLAB_BASE_URL,
    env.GITLAB_OAUTH_CLIENT_ID,
    env.GITLAB_OAUTH_CLIENT_SECRET,
    env.GITLAB_OAUTH_SCOPE,
    env.CAT_FACTORY_BASE_URL,
    env.CAT_FACTORY_SERVICE_ID,
    env.CAT_FACTORY_PIPELINE_ID,
    env.APP_BASE_URL,
  ])
}

function gatewaysFor(env: WorkerEnv): GatewayFactory {
  const key = gatewayKey(env)
  if (cachedGateways === null || cachedGateways.key !== key) {
    cachedGateways = { key, factory: buildGateways(env) }
  }
  return cachedGateways.factory
}

function buildGateways(env: WorkerEnv): GatewayFactory {
  return createGatewayFactory({
    github: {
      // `|| undefined` throughout, for the reason `containerFor` gives below: a
      // binding left blank is one nobody set, and `''` as a base URL builds
      // every path relative rather than falling back to the host's own root.
      apiBaseUrl: env.GITHUB_API_BASE_URL || undefined,
      app:
        env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
          ? { appId: env.GITHUB_APP_ID, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY }
          : null,
      oauth:
        env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET
          ? {
              clientId: env.GITHUB_OAUTH_CLIENT_ID,
              clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
              scope: env.GITHUB_OAUTH_SCOPE || undefined,
            }
          : null,
    },
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL || undefined,
      oauth:
        env.GITLAB_OAUTH_CLIENT_ID && env.GITLAB_OAUTH_CLIENT_SECRET
          ? {
              clientId: env.GITLAB_OAUTH_CLIENT_ID,
              clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
              scope: env.GITLAB_OAUTH_SCOPE || undefined,
            }
          : null,
    },
    appBaseUrl: env.APP_BASE_URL || undefined,
    aiReview: (apiKey) => aiReviewFrom(env, apiKey),
  })
}

/** cat-factory needs a base URL and a service id that no credential carries. */
function aiReviewFrom(env: WorkerEnv, apiKey: string): AiReviewGateway | null {
  const { CAT_FACTORY_BASE_URL, CAT_FACTORY_SERVICE_ID } = env
  if (!CAT_FACTORY_BASE_URL || !CAT_FACTORY_SERVICE_ID) return null
  return new CatFactoryAiReviewGateway({
    baseUrl: CAT_FACTORY_BASE_URL,
    apiKey,
    serviceId: CAT_FACTORY_SERVICE_ID,
    pipelineId: env.CAT_FACTORY_PIPELINE_ID || undefined,
  })
}

function buildAiReview(env: WorkerEnv): AiReviewGateway | null {
  return env.CAT_FACTORY_API_KEY ? aiReviewFrom(env, env.CAT_FACTORY_API_KEY) : null
}

function buildChat(env: WorkerEnv): ChatGateway | null {
  if (!env.SLACK_BOT_TOKEN) return null
  return new SlackChatGateway({
    botToken: env.SLACK_BOT_TOKEN,
    appBaseUrl: env.APP_BASE_URL || undefined,
  })
}

/** The environment's own credential per host: what a stored one takes precedence over. */
function buildVcs(env: WorkerEnv): EnvironmentVcsGateways {
  return {
    github: env.GITHUB_TOKEN
      ? new GitHubVcsGateway({
          tokens: staticTokenSource(env.GITHUB_TOKEN),
          baseUrl: env.GITHUB_API_BASE_URL || undefined,
        })
      : null,
    gitlab: env.GITLAB_TOKEN
      ? new GitLabVcsGateway({
          token: env.GITLAB_TOKEN,
          baseUrl: env.GITLAB_BASE_URL || undefined,
        })
      : null,
  }
}

export function containerFor(env: WorkerEnv): AppContainer {
  return createContainer({
    repositories,
    logger: workerLogger,
    chat: buildChat(env),
    vcs: buildVcs(env),
    aiReview: buildAiReview(env),
    gateways: gatewaysFor(env),
    bus,
    secrets: secretsFor(env),
    // `||` throughout, not `??`, exactly as the Node facade's `loadConfig` does
    // it: a binding left blank is one somebody has not set, `.dev.vars.example`
    // ships every name with no value, and `requireCapability` refuses only
    // `null`. An empty webhook secret would otherwise pass the guard that names
    // the missing variable and reach Web Crypto, which refuses a zero-length
    // HMAC key, so GitHub would be answered 500 by a deployment whose /health
    // reports the capability as ready.
    github: {
      appSlug: env.GITHUB_APP_SLUG || null,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
      botLogin: env.GITHUB_BOT_LOGIN || null,
      labels: {
        review: env.GITHUB_LABEL_REVIEW || DEFAULT_GITHUB_LABELS.review,
        aiReview: env.GITHUB_LABEL_AI_REVIEW || DEFAULT_GITHUB_LABELS.aiReview,
        skillPrefix: env.GITHUB_LABEL_SKILL_PREFIX || DEFAULT_GITHUB_LABELS.skillPrefix,
      },
    },
    slack: {
      signingSecret: env.SLACK_SIGNING_SECRET || null,
      announcementChannelId: env.SLACK_CHANNEL_ID || null,
    },
    appBaseUrl: env.APP_BASE_URL || null,
  })
}

export function corsOriginsFor(env: WorkerEnv): string[] {
  const configured = env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return configured === undefined || configured.length === 0 ? ['*'] : configured
}
