import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Connection wire contracts: how this deployment reaches GitHub and Slack, and
// what an operator still has to do about it.
//
// Separate from `settings.ts`, which is about one CREDENTIAL at a time. A
// connection is the whole story for one system: which of several credentials is
// actually in force, what the deployment could offer instead, and which inbound
// surfaces are live. The Configuration screen needs all of it in one read, and
// the questions it answers ("why is nothing arriving from GitHub?") are not
// answerable from a per-token state.
// ---------------------------------------------------------------------------

/**
 * How a deployment authenticates to GitHub, strongest first. The order IS the
 * precedence the resolver applies, and it is documented here rather than in the
 * resolver because it is the thing an operator has to be able to predict:
 *
 *   - `app`         a GitHub App installation token, minted per repository. The
 *                   only credential that is not a person's, so a deployment that
 *                   has registered an App uses it and nothing shadows it.
 *   - `oauth`       the token from a "Sign in with GitHub" round trip. Minted by
 *                   this deployment's own OAuth client, revocable by the person
 *                   who granted it from their own GitHub settings.
 *   - `pat`         a personal access token somebody pasted. Long-lived, carrying
 *                   whatever scopes that person happened to give it, which is why
 *                   it sits below a credential minted through a live sign-in.
 *   - `environment` `GITHUB_TOKEN` on the process. Last, because it is the one an
 *                   operator cannot see or change from the board.
 */
export const githubAuthMethodSchema = v.picklist(['app', 'oauth', 'pat', 'environment'])
export type GitHubAuthMethod = v.InferOutput<typeof githubAuthMethodSchema>

/**
 * The labels that make GitHub drive the board, so the screen can tell a team what
 * to type on a pull request. Deployment configuration rather than stored state:
 * they are read from the environment, and a team that renames one renames it in
 * one place.
 */
export const githubLabelRulesSchema = v.object({
  /** Adding this label opens a review request and routes it. */
  review: v.string(),
  /** Adding this label hands the pull request to cat-factory. */
  aiReview: v.string(),
  /** `skill:payments` on a pull request becomes the required skill `payments`. */
  skillPrefix: v.string(),
})
export type GitHubLabelRules = v.InferOutput<typeof githubLabelRulesSchema>

export const githubConnectionSchema = v.object({
  /** The credential GitHub calls are made with right now. Null when there is none. */
  activeMethod: v.nullable(githubAuthMethodSchema),
  /**
   * The methods this deployment could connect with, whether or not one is
   * connected. `app` appears once an App id and private key are configured,
   * `oauth` once an OAuth client is, `pat` always (pasting one needs nothing but
   * an encryption key), `environment` when `GITHUB_TOKEN` is set.
   *
   * `activeMethod` is always one of these. A method that could be in force and
   * is not listed here would leave a screen reporting a credential it also says
   * the deployment cannot hold.
   */
  availableMethods: v.array(githubAuthMethodSchema),
  /**
   * Whether an App INSTALL can be offered, which needs `GITHUB_APP_SLUG` on top
   * of the id and the key: the install page is addressed by the slug, so without
   * one there is nowhere to send an operator. Separate from `app` in
   * `availableMethods` because a deployment whose App is already installed
   * authenticates with it perfectly well and has nothing left to install.
   */
  appInstallable: v.boolean(),
  /** The GitHub login behind the active credential, when it has one. */
  account: v.nullable(v.string()),
  /**
   * Whether an inbound delivery can be VERIFIED. False leaves the webhook route
   * refusing every delivery rather than trusting an unsigned one, so a screen
   * that reported the connection as healthy would be reporting a route that
   * answers 503 to GitHub on every event.
   */
  webhooksReady: v.boolean(),
  /** The login the bot answers to when it is @-mentioned in a comment. */
  botLogin: v.nullable(v.string()),
  labels: githubLabelRulesSchema,
})
export type GitHubConnection = v.InferOutput<typeof githubConnectionSchema>

export const slackConnectionSchema = v.object({
  /** Whether a message can be delivered at all: a bot token is resolvable. */
  ready: v.boolean(),
  /** The channel new review requests are announced in. Null leaves announcements off. */
  announcementChannelId: v.nullable(v.string()),
  /**
   * Whether the slash command and the message buttons can be verified
   * (`SLACK_SIGNING_SECRET`). Independent of `ready`: posting out needs a bot
   * token, and trusting what comes back needs the signing secret, and a
   * deployment can easily have one without the other.
   */
  interactivityReady: v.boolean(),
})
export type SlackConnection = v.InferOutput<typeof slackConnectionSchema>

export const connectionsSchema = v.object({
  github: githubConnectionSchema,
  slack: slackConnectionSchema,
})
export type Connections = v.InferOutput<typeof connectionsSchema>

/**
 * Where to send the browser to start a connect round trip. Returned rather than
 * redirected to, because the caller is the SPA rather than a navigation: it opens
 * the URL itself, and a 302 out of `fetch` would be followed by the client and
 * land the GitHub page in a JSON parse.
 */
export const connectStartSchema = v.object({ url: v.pipe(v.string(), v.url()) })
export type ConnectStart = v.InferOutput<typeof connectStartSchema>
