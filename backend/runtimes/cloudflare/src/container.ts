import { CatFactoryAiReviewGateway } from '@sainte-beuve/ai-review'
import {
  createGatewayFactory,
  GitHubVcsGateway,
  GitLabVcsGateway,
  SlackChatGateway,
  staticTokenSource,
} from '@sainte-beuve/integrations'
import type {
  AiReviewGateway,
  ChatGateway,
  GatewayFactory,
  Logger,
  PersistenceKind,
  PersistenceProvider,
} from '@sainte-beuve/kernel'
import { createD1Store } from '@sainte-beuve/persistence-d1'
import { createInMemoryPersistence } from '@sainte-beuve/persistence-memory'
import {
  type AppContainer,
  type AuthWiring,
  authModeFrom,
  createContainer,
  DEFAULT_GITHUB_LABELS,
  DEFAULT_SESSION_LIFETIME_MS,
  type EnvironmentVcsGateways,
  InMemoryAttentionBus,
  type SecretsWiring,
  secretsFrom,
  withAppOrigin,
} from '@sainte-beuve/server'
import type { WorkerEnv } from './env.js'

/**
 * The fallback store, for a Worker with no `DB` binding.
 *
 * MODULE-LEVEL, because the container is rebuilt per request here and a store
 * built with it would lose the board between two calls rather than between two
 * isolates. It is not a production configuration and `/health` says so
 * (`persistence: "memory"`): bind D1 and this line is never reached. What it
 * buys is `wrangler dev` and a first deploy that work before anybody has
 * created a database.
 */
const fallbackStores = createInMemoryPersistence()

/**
 * The store this request runs against.
 *
 * D1 whenever the deployment bound one, and the binding is read per request
 * because that is the only place bindings exist. The wrapper around it is
 * three methods over `prepare`, so building it per request costs nothing worth
 * caching.
 */
function storeFor(env: WorkerEnv): { stores: PersistenceProvider; kind: PersistenceKind } {
  return env.DB === undefined
    ? { stores: fallbackStores, kind: 'memory' }
    : { stores: createD1Store(env.DB), kind: 'd1' }
}

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
  const store = storeFor(env)
  return createContainer({
    stores: store.stores,
    persistence: store.kind,
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
    auth: authFor(env),
    appBaseUrl: env.APP_BASE_URL || null,
  })
}

/**
 * How much this Worker insists on knowing who is calling.
 *
 * The mode comes from `authModeFrom`, which the Node facade reads the same way:
 * an unrecognised value is a configuration error rather than a quiet `open`, and
 * `open` beside a public origin is refused rather than served. The quiet failure
 * this replaces was a Worker serving `AUTH_MODE=oepn` as a public admin.
 *
 * WHERE THE TWO RUNTIMES CANNOT BE SYMMETRIC, and how close they get. Node reads
 * its environment once and refuses to start, so a bad value is caught by
 * whoever ran the deploy. A Worker is handed its bindings with the request and
 * has no boot to fail in, so `wrangler deploy` accepts the misconfiguration and
 * the refusal can only happen per request. What it must NOT be is an anonymous
 * 500 legible only in `wrangler tail`: `authModeFrom` throws a
 * `ConfigurationError`, so every request — `/health` included — is answered 503
 * with the same sentence Node prints on stderr, naming the variable and the
 * origin. An operator who curls the deployment learns what an operator reading
 * Node's stderr learns, which is as far as the asymmetry can be closed from
 * here.
 */
function authFor(env: WorkerEnv): AuthWiring {
  const lifetime = Number.parseInt(env.AUTH_SESSION_LIFETIME_MS ?? '', 10)
  return {
    mode: authModeFrom({
      value: env.AUTH_MODE,
      appBaseUrl: env.APP_BASE_URL,
      corsOrigins: corsOriginsFor(env),
    }),
    environmentApiKey: env.AUTH_API_KEY || null,
    sessionLifetimeMs:
      Number.isNaN(lifetime) || lifetime <= 0 ? DEFAULT_SESSION_LIFETIME_MS : lifetime,
  }
}

/**
 * The origins this Worker answers.
 *
 * The SPA's own origin is folded in, because a deployment that said where its
 * SPA lives has NAMED an origin: the client sends `credentials: 'include'` on
 * every call and a browser refuses any answer to one carrying
 * `Access-Control-Allow-Origin: *`, so a hosted deployment left on the wildcard
 * `wrangler.toml` ships would otherwise lose every request rather than only its
 * sign-in. Node reads it the same way. See `withAppOrigin`.
 */
export function corsOriginsFor(env: WorkerEnv): string[] {
  const configured = env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  const origins = configured === undefined || configured.length === 0 ? ['*'] : configured
  return withAppOrigin(origins, env.APP_BASE_URL)
}
