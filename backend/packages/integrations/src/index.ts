// `@sainte-beuve/integrations`: the GitHub and Slack adapters behind the kernel
// ports. Everything here is replaceable: the domain packages know the port, never
// the vendor.

export {
  createGatewayFactory,
  type GatewayFactoryConfig,
  type GitHubFactoryConfig,
  type GitLabFactoryConfig,
  type OAuthClientConfig,
} from './factory.js'
export {
  GITHUB_API_BASE_URL,
  GITHUB_WEB_BASE_URL,
  GitHubApiError,
  githubApiStatusOf,
  githubRequest,
  repoPath,
} from './github/client.js'
export { appTokenSource, type GitHubTokenSource, staticTokenSource } from './github/credentials.js'
export {
  type BotVerb,
  botMentionLogin,
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
  GITLAB_BASE_URL,
  GitLabApiError,
  gitlabApiStatusOf,
  gitlabRequest,
  projectPath,
} from './gitlab/client.js'
export {
  GitLabIdentityGateway,
  type GitLabIdentityGatewayOptions,
} from './gitlab/GitLabIdentityGateway.js'
export { type GitLabGatewayOptions, GitLabVcsGateway } from './gitlab/GitLabVcsGateway.js'
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
  escapeSlackText,
  reminderMessage,
  type SlackBlock,
  slackLink,
  type SlackMessage,
} from './slack/message.js'
export { postSlackResponse, type SlackResponseMessage } from './slack/respond.js'
export { SlackChatGateway, type SlackGatewayOptions } from './slack/SlackChatGateway.js'
export { verifySlackSignature } from './slack/signature.js'
