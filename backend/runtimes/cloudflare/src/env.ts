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

  /**
   * GitHub, in the three shapes a deployment can be connected in. They are not
   * alternatives to choose between at deploy time: whichever are configured are
   * OFFERED, and the strongest one present is what calls are made with (see
   * `githubAuthMethodSchema` in @sainte-beuve/contracts for the order).
   */

  /** A personal access token, for a deployment that wants no app registration. */
  GITHUB_TOKEN?: string
  /** GitHub Enterprise Server's API base. Defaults to api.github.com. */
  GITHUB_API_BASE_URL?: string
  /** The shared secret inbound deliveries are signed with. Without it they are refused. */
  GITHUB_WEBHOOK_SECRET?: string

  /**
   * The GitHub App. `GITHUB_APP_ID` signs the JWT and `GITHUB_APP_SLUG` addresses
   * the public install page: they are different strings for the same App, and
   * both are needed to OFFER an install. The private key must be PKCS#8
   * (`-----BEGIN PRIVATE KEY-----`); GitHub issues PKCS#1, so convert it once
   * with `openssl pkcs8 -topk8 -nocrypt`.
   */
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY?: string

  /** The OAuth client behind "Sign in with GitHub". A GitHub App's own client works. */
  GITHUB_OAUTH_CLIENT_ID?: string
  GITHUB_OAUTH_CLIENT_SECRET?: string
  /** Scopes the sign-in asks for. `read:user` unless the credential also does the repo work. */
  GITHUB_OAUTH_SCOPE?: string

  /** The login the bot answers to when @-mentioned in a pull-request comment. */
  GITHUB_BOT_LOGIN?: string
  /** The labels that drive the board. Defaults in `DEFAULT_GITHUB_LABELS`. */
  GITHUB_LABEL_REVIEW?: string
  GITHUB_LABEL_AI_REVIEW?: string
  GITHUB_LABEL_SKILL_PREFIX?: string

  /** Slack. */
  SLACK_BOT_TOKEN?: string
  SLACK_SIGNING_SECRET?: string
  SLACK_CHANNEL_ID?: string

  /** Base URL of the sainte-beuve SPA, so a chat message can link back to a review. */
  APP_BASE_URL?: string

  /**
   * Master key for the credentials an operator enters on the Configuration
   * screen, base64, 32 bytes or more (`openssl rand -base64 32`). Without it the
   * screen refuses to store anything rather than writing a token in the clear,
   * and the connect flows refuse to start, because the state they carry has to
   * be signed and the credential they return has to be sealed. Rotating it makes
   * every token sealed under the old key unreadable, which the screen reports as
   * such.
   */
  SETTINGS_ENCRYPTION_KEY?: string
}
