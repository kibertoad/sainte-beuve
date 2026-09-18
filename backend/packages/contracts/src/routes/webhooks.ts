// ---------------------------------------------------------------------------
// The inbound paths third parties are pointed at.
//
// These are the only routes in the tree that are NOT api contracts, and the
// reason is that we do not own either half of them. The request body is GitHub's
// event union or Slack's form encoding, so a valibot schema over it would be a
// copy of somebody else's spec that goes stale silently; the response is a
// redirect or a bare ack, which is not a model. What a contract would still have
// given us is one definition of the PATH, so that is what these constants are:
// the controller mounts them and the docs quote them, and neither hand-writes a
// string GitHub and Slack were configured with months ago.
//
// They sit OUTSIDE `/api/v1` deliberately. Their URLs are registered in a GitHub
// App and a Slack app by hand, so they have to survive an API version bump.
// ---------------------------------------------------------------------------

import type { VcsProvider } from '../vcs.js'

/** Signed GitHub deliveries (`X-Hub-Signature-256`). */
export const GITHUB_WEBHOOK_PATH = '/webhooks/github'

/**
 * Slack slash commands and message actions (`X-Slack-Signature`), for the
 * DEFAULT org.
 *
 * Every deployment that registered a Slack app before the intake knew about
 * tenancies is pointed here, and here is where it stays: the deployment's own
 * `SLACK_SIGNING_SECRET` is the default org's secret, so this path keeps
 * behaving exactly as it did.
 */
export const SLACK_WEBHOOK_PATH = '/webhooks/slack'

/**
 * The same surface, for one NAMED org. Mounted as a pattern; built for a screen
 * to quote with {@link slackWebhookPath}.
 *
 * The URL is what places a delivery in a tenancy, and the org's OWN signing
 * secret is what makes the placement true: a stranger can name any slug here and
 * cannot sign for it. That is why the slug is allowed to be in a path at all,
 * where no route under `/api/v1` accepts an org — there is no credential on an
 * inbound Slack request until the secret this path selects has verified it, and
 * selecting the wrong one refuses rather than admits.
 *
 * The alternative was placing a command by the `team_id` in its body, which
 * needs a fourth read across the boundary and a workspace-to-org table, and
 * which would still have to be trusted BEFORE a signature had been checked
 * against anything.
 */
export const SLACK_ORG_WEBHOOK_PATH = `${SLACK_WEBHOOK_PATH}/:org`

/** Where one org's Slack app posts. The default org answers on both this and the bare path. */
export function slackWebhookPath(orgSlug: string): string {
  return `${SLACK_WEBHOOK_PATH}/${orgSlug}`
}

/**
 * Where a host returns the browser after a sign-in. One path per host, so an
 * OAuth client registered against one cannot have its code spent by the other's
 * callback, and each is a fixed string an operator types into a settings page.
 */
export const SIGN_IN_CALLBACK_PATHS = {
  github: '/connect/github/callback',
  gitlab: '/connect/gitlab/callback',
} as const satisfies Record<VcsProvider, string>

export function signInCallbackPath(provider: VcsProvider): string {
  return SIGN_IN_CALLBACK_PATHS[provider]
}

/**
 * Where GitHub returns the browser after the App is installed. It carries an
 * `installation_id` this deployment deliberately does not store: an installation
 * is resolved per repository at call time, so there is no binding to keep in step
 * with what somebody later changes on GitHub.
 */
export const GITHUB_APP_SETUP_PATH = '/connect/github/setup'
