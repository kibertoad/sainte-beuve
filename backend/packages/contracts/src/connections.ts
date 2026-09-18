import * as v from 'valibot'
import { vcsProviderSchema } from './vcs.js'

// ---------------------------------------------------------------------------
// Connection wire contracts: how this deployment reaches its source-control
// hosts and Slack, and what an operator still has to do about it.
//
// Separate from `settings.ts`, which is about one CREDENTIAL at a time. A
// connection is the whole story for one system: which of several credentials is
// actually in force, what the deployment could offer instead, and which inbound
// surfaces are live. The Configuration screen needs all of it in one read, and
// the questions it answers ("why is nothing arriving from GitHub?") are not
// answerable from a per-token state.
// ---------------------------------------------------------------------------

/**
 * How a deployment authenticates to a source-control host, strongest first. The
 * order IS the precedence the resolver applies, and it is documented here rather
 * than in the resolver because it is the thing an operator has to be able to
 * predict:
 *
 *   - `app`         a GitHub App installation token, minted per repository. The
 *                   only credential that is not a person's, so a deployment that
 *                   has registered an App uses it and nothing shadows it. GitHub
 *                   only: GitLab has no equivalent, and a group access token
 *                   there is a pasted token like any other.
 *   - `oauth`       the token from a sign-in round trip. Minted by this
 *                   deployment's own OAuth client, revocable by the person who
 *                   granted it from their own account settings.
 *   - `pat`         a personal access token somebody pasted. Long-lived, carrying
 *                   whatever scopes that person happened to give it, which is why
 *                   it sits below a credential minted through a live sign-in.
 *   - `environment` `GITHUB_TOKEN` / `GITLAB_TOKEN` on the process. Last, because
 *                   it is the one an operator cannot see or change from the board.
 */
export const vcsAuthMethodSchema = v.picklist(['app', 'oauth', 'pat', 'environment'])
export type VcsAuthMethod = v.InferOutput<typeof vcsAuthMethodSchema>

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

export const vcsConnectionSchema = v.object({
  provider: vcsProviderSchema,
  /** The credential this host's calls are made with right now. Null when there is none. */
  activeMethod: v.nullable(vcsAuthMethodSchema),
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
  availableMethods: v.array(vcsAuthMethodSchema),
  /**
   * Whether an App INSTALL can be offered, which needs `GITHUB_APP_SLUG` on top
   * of the id and the key: the install page is addressed by the slug, so without
   * one there is nowhere to send an operator. Separate from `app` in
   * `availableMethods` because a deployment whose App is already installed
   * authenticates with it perfectly well and has nothing left to install.
   */
  appInstallable: v.boolean(),
  /** The account handle behind the active credential, when it has one. */
  account: v.nullable(v.string()),
  /**
   * Whether this build has a webhook intake for the host at all. Separate from
   * `webhooksReady`, which is about the SECRET: a host with no intake has
   * nothing to configure and no warning to show, while one with an intake and
   * no secret is a route that refuses every delivery. Collapsed into one flag,
   * a screen would either nag about a webhook that does not exist or stay
   * silent about one that is broken.
   */
  inboundIntake: v.boolean(),
  /**
   * Whether an inbound delivery can be VERIFIED. False leaves the webhook route
   * refusing every delivery rather than trusting an unsigned one, so a screen
   * that reported the connection as healthy would be reporting a route that
   * answers 503 to the host on every event.
   */
  webhooksReady: v.boolean(),
  /** The login the bot answers to when it is @-mentioned in a comment. */
  botLogin: v.nullable(v.string()),
  labels: githubLabelRulesSchema,
})
export type VcsConnection = v.InferOutput<typeof vcsConnectionSchema>

export const slackConnectionSchema = v.object({
  /** Whether a message can be delivered at all: a bot token is resolvable. */
  ready: v.boolean(),
  /** The channel new review requests are announced in. Null leaves announcements off. */
  announcementChannelId: v.nullable(v.string()),
  /**
   * Whether the slash command and the message buttons can be verified: this org
   * stored a signing secret, or it is the default org and the deployment set
   * `SLACK_SIGNING_SECRET`. Independent of `ready`: posting out needs a bot
   * token, and trusting what comes back needs the signing secret, and a
   * deployment can easily have one without the other.
   */
  interactivityReady: v.boolean(),
  /**
   * Where THIS org's Slack app posts, as a path to hang off the API's own
   * origin.
   *
   * On the response rather than built in the SPA, because it is the one field
   * here that differs per tenancy: a second org's commands are placed by the
   * slug in this path, so a screen that assembled the URL from a constant would
   * hand every org the default org's. See `SLACK_ORG_WEBHOOK_PATH`.
   */
  requestPath: v.string(),
})
export type SlackConnection = v.InferOutput<typeof slackConnectionSchema>

export const connectionsSchema = v.object({
  /**
   * One entry per host an adapter exists for, always all of them. A host with
   * nothing configured is reported with no active method rather than omitted:
   * "GitLab is not connected" and "this build cannot talk to GitLab" are
   * different answers, and only the first is true.
   */
  vcs: v.array(vcsConnectionSchema),
  slack: slackConnectionSchema,
})
export type Connections = v.InferOutput<typeof connectionsSchema>

/**
 * Where to send the browser to start a connect round trip. Returned rather than
 * redirected to, because the caller is the SPA rather than a navigation: it opens
 * the URL itself, and a 302 out of `fetch` would be followed by the client and
 * land the host's page in a JSON parse.
 */
export const connectStartSchema = v.object({ url: v.pipe(v.string(), v.url()) })
export type ConnectStart = v.InferOutput<typeof connectStartSchema>
