// `@sainte-beuve/integrations`: the GitHub and Slack adapters behind the kernel
// ports. Everything here is replaceable: the domain packages know the port, never
// the vendor.

export { type GitHubGatewayOptions, GitHubVcsGateway } from './github/GitHubVcsGateway.js'
export {
  type PullRequestEventPayload,
  reviewRequestFromPullRequestEvent,
  verifyGitHubSignature,
} from './github/webhooks.js'
export { SlackChatGateway, type SlackGatewayOptions } from './slack/SlackChatGateway.js'
export { verifySlackSignature } from './slack/signature.js'
