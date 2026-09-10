import { CatFactoryAiReviewGateway } from '@sainte-beuve/ai-review'
import { GitHubVcsGateway, SlackChatGateway } from '@sainte-beuve/integrations'
import type { Logger } from '@sainte-beuve/kernel'
import { createInMemoryRepositories } from '@sainte-beuve/persistence-memory'
import { type AppContainer, createContainer } from '@sainte-beuve/server'
import { pino } from 'pino'
import type { NodeConfig } from './config.js'

/**
 * Assemble the Node facade's container once, at boot.
 *
 * The in-memory store is the placeholder the Postgres adapter replaces in slice 5
 * (docs/implementation-plan.md). It is called out here as well as in the Worker
 * facade because the two must stay SYMMETRIC: a capability wired on one runtime and
 * not the other is the failure mode this layout exists to prevent.
 */
export function buildContainer(config: NodeConfig): AppContainer {
  const logger: Logger = pino({ level: config.logLevel })
  return createContainer({
    repositories: createInMemoryRepositories(),
    logger,
    chat:
      config.slack === null
        ? null
        : new SlackChatGateway({
            botToken: config.slack.botToken,
            appBaseUrl: config.appBaseUrl,
          }),
    vcs: config.github === null ? null : new GitHubVcsGateway(config.github),
    aiReview: config.catFactory === null ? null : new CatFactoryAiReviewGateway(config.catFactory),
    announcementChannelId: config.slack?.channelId ?? null,
  })
}
