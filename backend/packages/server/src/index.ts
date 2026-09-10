// `@sainte-beuve/server`: the runtime-neutral HTTP layer. A facade supplies a
// container and serves the app; everything else lives here.

export { type AppOptions, type RequestScope, createApp } from './app.js'
export {
  type AppContainer,
  type ContainerOptions,
  createContainer,
  DEFAULT_GITHUB_LABELS,
  type EnvironmentVcsGateways,
  type GitHubWiring,
  NO_VCS_GATEWAYS,
  type SlackWiring,
} from './container.js'
export type { AppEnv } from './http/env.js'
export { HmacStateSigner, STATE_LIFETIME_MS } from './crypto/HmacStateSigner.js'
export {
  secretsFrom,
  type SecretsWiring,
  WebCryptoSecretCipher,
  type WebCryptoSecretCipherOptions,
} from './crypto/WebCryptoSecretCipher.js'
export { errorBody, handleError, requireCapability } from './http/errors.js'
export { HINT_LENGTH, hintOf } from './integrations/credentials.js'
export {
  type CredentialSource,
  openCredential,
  type Resolved,
  resolveAiReview,
  resolveChat,
  resolveVcs,
} from './integrations/resolve.js'
export { AttentionService, concerns, reaches } from './modules/attention/AttentionService.js'
export { ConnectionsService } from './modules/connections/ConnectionsService.js'
export { ViewerService } from './modules/identity/ViewerService.js'
export { ProjectService } from './modules/projects/ProjectService.js'
export { WorkspaceService } from './modules/workspace/WorkspaceService.js'
export { InMemoryAttentionBus } from './realtime/InMemoryAttentionBus.js'
export { sseStream, type SseStreamOptions } from './realtime/sse.js'
export { AiReviewService } from './modules/reviews/AiReviewService.js'
export { ReviewService } from './modules/reviews/ReviewService.js'
export { ReviewerService } from './modules/reviewers/ReviewerService.js'
export { IntegrationSettingsService } from './modules/settings/IntegrationSettingsService.js'
export { GitHubWebhookService } from './modules/webhooks/GitHubWebhookService.js'
export { SlackWebhookService } from './modules/webhooks/SlackWebhookService.js'
export { snoozeReview } from './reminders/snooze.js'
export { runReminderTick, type TickResult } from './reminders/tick.js'
