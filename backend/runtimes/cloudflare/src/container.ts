import { CatFactoryAiReviewGateway } from '@sainte-beuve/ai-review'
import { GitHubVcsGateway, SlackChatGateway } from '@sainte-beuve/integrations'
import type { AiReviewGateway, ChatGateway, Logger, VcsGateway } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import {
  type AppContainer,
  createContainer,
  type SecretCipherWiring,
  secretCipherFrom,
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

/** `console` is the Workers-native logger; Workers Logs picks up structured lines. */
const workerLogger: Logger = {
  debug: (obj, msg) => console.debug(msg ?? '', obj),
  info: (obj, msg) => console.info(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
}

/**
 * The cipher, kept alive across requests like the store above it.
 *
 * `containerFor` runs PER REQUEST on this runtime (bindings only exist inside
 * one), and the cipher is the one thing on the container that carries a cache
 * worth keeping: it memoises the HKDF key import and the key id, and a fresh
 * instance per request throws both away before they are used twice. A mistyped
 * key is the louder half, because the construction failure logs, and a log line
 * on every request (`/health` included) is a Workers Logs flood on a runtime
 * billed by CPU time. Keyed by the master key value, so a binding change on a
 * warm isolate still takes effect.
 */
let cachedSecrets: { masterKey: string | undefined; wiring: SecretCipherWiring } | null = null

function secretsFor(env: WorkerEnv): SecretCipherWiring {
  if (cachedSecrets === null || cachedSecrets.masterKey !== env.SETTINGS_ENCRYPTION_KEY) {
    cachedSecrets = {
      masterKey: env.SETTINGS_ENCRYPTION_KEY,
      wiring: secretCipherFrom({
        masterKeyBase64: env.SETTINGS_ENCRYPTION_KEY,
        logger: workerLogger,
      }),
    }
  }
  return cachedSecrets.wiring
}

function buildAiReview(env: WorkerEnv): AiReviewGateway | null {
  const { CAT_FACTORY_BASE_URL, CAT_FACTORY_API_KEY, CAT_FACTORY_SERVICE_ID } = env
  if (!CAT_FACTORY_BASE_URL || !CAT_FACTORY_API_KEY || !CAT_FACTORY_SERVICE_ID) return null
  return new CatFactoryAiReviewGateway({
    baseUrl: CAT_FACTORY_BASE_URL,
    apiKey: CAT_FACTORY_API_KEY,
    serviceId: CAT_FACTORY_SERVICE_ID,
    pipelineId: env.CAT_FACTORY_PIPELINE_ID,
  })
}

function buildChat(env: WorkerEnv): ChatGateway | null {
  if (!env.SLACK_BOT_TOKEN) return null
  return new SlackChatGateway({ botToken: env.SLACK_BOT_TOKEN, appBaseUrl: env.APP_BASE_URL })
}

function buildVcs(env: WorkerEnv): VcsGateway | null {
  if (!env.GITHUB_TOKEN) return null
  return new GitHubVcsGateway({ token: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_BASE_URL })
}

export function containerFor(env: WorkerEnv): AppContainer {
  return createContainer({
    repositories,
    logger: workerLogger,
    chat: buildChat(env),
    vcs: buildVcs(env),
    aiReview: buildAiReview(env),
    secrets: secretsFor(env),
    announcementChannelId: env.SLACK_CHANNEL_ID ?? null,
  })
}

export function corsOriginsFor(env: WorkerEnv): string[] {
  const configured = env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return configured === undefined || configured.length === 0 ? ['*'] : configured
}
