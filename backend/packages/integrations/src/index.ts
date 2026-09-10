// `@sainte-beuve/integrations`: the GitHub and Slack adapters behind the kernel
// ports. Everything here is replaceable: the domain packages know the port, never
// the vendor.

export { createGatewayFactory, type GatewayFactoryConfig } from './factory.js'
export {
  GITHUB_API_BASE_URL,
  GITHUB_WEB_BASE_URL,
  GitHubApiError,
  githubApiStatusOf,
  githubRequest,
} from './github/client.js'
export { appTokenSource, type GitHubTokenSource, staticTokenSource } from './github/credentials.js'
export {
  type BotVerb,
  type GitHubDelivery,
  type GitHubEventPayload,
  type GitHubIntent,
  type GitHubIntentContext,
  type GitHubIssuePayload,
  type GitHubPullRequestPayload,
  interpretGitHubDelivery,
  parseBotCommand,
} from './github/events.js'
export { GitHubAppAuth, type GitHubAppAuthOptions } from './github/GitHubAppAuth.js'
export {
  GitHubIdentityGateway,
  type GitHubIdentityGatewayOptions,
} from './github/GitHubIdentityGateway.js'
export { type GitHubGatewayOptions, GitHubVcsGateway } from './github/GitHubVcsGateway.js'
export { verifyGitHubSignature } from './github/webhooks.js'
export {
  DEFAULT_SNOOZE_HOURS,
  parseCommandText,
  parseSlackRequest,
  SLACK_ACTIONS,
  type SlackIntent,
  type SlackRequest,
} from './slack/commands.js'
export {
  announcementMessage,
  reminderMessage,
  type SlackBlock,
  type SlackMessage,
} from './slack/message.js'
export { SlackChatGateway, type SlackGatewayOptions } from './slack/SlackChatGateway.js'
export { verifySlackSignature } from './slack/signature.js'
