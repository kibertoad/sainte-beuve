/**
 * The Worker's environment: every binding and var a deployment's wrangler.toml
 * supplies. All the integration values are OPTIONAL, and that is the deployment
 * contract, not laziness. A Worker with no Slack token still serves the board and
 * reports the gap on `/health`, which is what makes a first deploy possible before
 * any app registration exists.
 */
export interface WorkerEnv {
  /** Comma-separated list of origins the SPA is served from. `*` in a preview. */
  CORS_ORIGINS?: string

  /** cat-factory: the instance AI reviews are delegated to. */
  CAT_FACTORY_BASE_URL?: string
  CAT_FACTORY_API_KEY?: string
  CAT_FACTORY_SERVICE_ID?: string
  CAT_FACTORY_PIPELINE_ID?: string

  /** GitHub: a token today, a GitHub App installation once slice 3 lands. */
  GITHUB_TOKEN?: string
  GITHUB_API_BASE_URL?: string
  GITHUB_WEBHOOK_SECRET?: string

  /** Slack. */
  SLACK_BOT_TOKEN?: string
  SLACK_SIGNING_SECRET?: string
  SLACK_CHANNEL_ID?: string

  /** Base URL of the sainte-beuve SPA, so a chat message can link back to a review. */
  APP_BASE_URL?: string
}
