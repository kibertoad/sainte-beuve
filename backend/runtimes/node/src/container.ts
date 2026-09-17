import { CatFactoryAiReviewGateway } from '@sainte-beuve/ai-review'
import {
  createGatewayFactory,
  GitHubVcsGateway,
  GitLabVcsGateway,
  SlackChatGateway,
  staticTokenSource,
} from '@sainte-beuve/integrations'
import type { AiReviewGateway, GatewayFactory, Logger } from '@sainte-beuve/kernel'
import {
  type AppContainer,
  createContainer,
  type EnvironmentVcsGateways,
  InMemoryAttentionBus,
  secretsFrom,
} from '@sainte-beuve/server'
import type { NodeConfig } from './config.js'
import type { NodeStore } from './persistence.js'

/**
 * Assemble the Node facade's container once, at boot.
 *
 * The STORE is opened before this and handed in (`openStore`), because opening
 * it is asynchronous and running the migrations is part of it: a container
 * factory that reached for a database would make every caller of it wait on
 * a schema.
 *
 * The gateway FACTORY is built here, and it is what lets a credential entered
 * on the Configuration screen take effect on a process that read its environment
 * at boot: the container is built once, and the gateway a request authenticates
 * with is resolved per request from whatever is stored (see
 * `integrations/resolve.ts` in @sainte-beuve/server).
 */
export function buildContainer(config: NodeConfig, store: NodeStore, logger: Logger): AppContainer {
  return createContainer({
    stores: store.stores,
    persistence: store.kind,
    logger,
    chat:
      config.slack.botToken === null
        ? null
        : new SlackChatGateway({
            botToken: config.slack.botToken,
            appBaseUrl: config.appBaseUrl,
          }),
    vcs: environmentVcs(config),
    aiReview:
      config.catFactoryApiKey === null ? null : aiReviewFrom(config, config.catFactoryApiKey),
    gateways: gatewaysFor(config),
    // Built once, with the container, because this facade is one process: every
    // stream a page opens against it is on the same bus.
    bus: new InMemoryAttentionBus(),
    secrets: secretsFrom({ masterKeyBase64: config.encryptionKey, logger }),
    github: {
      appSlug: config.github.appSlug,
      webhookSecret: config.github.webhookSecret,
      botLogin: config.github.botLogin,
      labels: config.github.labels,
    },
    slack: {
      signingSecret: config.slack.signingSecret,
      announcementChannelId: config.slack.channelId,
    },
    auth: {
      mode: config.auth.mode,
      environmentApiKey: config.auth.apiKey,
      sessionLifetimeMs: config.auth.sessionLifetimeMs,
    },
    appBaseUrl: config.appBaseUrl ?? null,
  })
}

/** The environment's own credential per host: what a stored one takes precedence over. */
function environmentVcs(config: NodeConfig): EnvironmentVcsGateways {
  return {
    github:
      config.github.token === null
        ? null
        : new GitHubVcsGateway({
            tokens: staticTokenSource(config.github.token),
            baseUrl: config.github.baseUrl,
          }),
    gitlab:
      config.gitlab.token === null
        ? null
        : new GitLabVcsGateway({ token: config.gitlab.token, baseUrl: config.gitlab.baseUrl }),
  }
}

function gatewaysFor(config: NodeConfig): GatewayFactory {
  return createGatewayFactory({
    github: {
      apiBaseUrl: config.github.baseUrl,
      app: config.github.app,
      oauth: config.github.oauth,
    },
    gitlab: { baseUrl: config.gitlab.baseUrl, oauth: config.gitlab.oauth },
    appBaseUrl: config.appBaseUrl,
    aiReview: (apiKey) => aiReviewFrom(config, apiKey),
  })
}

/** cat-factory needs a base URL and a service id that no credential carries. */
function aiReviewFrom(config: NodeConfig, apiKey: string): AiReviewGateway | null {
  if (config.catFactory === null) return null
  return new CatFactoryAiReviewGateway({ ...config.catFactory, apiKey })
}
