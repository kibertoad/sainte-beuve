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

/** Signed GitHub deliveries (`X-Hub-Signature-256`). */
export const GITHUB_WEBHOOK_PATH = '/webhooks/github'

/** Slack slash commands and message actions (`X-Slack-Signature`). */
export const SLACK_WEBHOOK_PATH = '/webhooks/slack'

/** Where GitHub returns the browser after a "Sign in with GitHub". */
export const GITHUB_SIGN_IN_CALLBACK_PATH = '/connect/github/callback'

/**
 * Where GitHub returns the browser after the App is installed. It carries an
 * `installation_id` this deployment deliberately does not store: an installation
 * is resolved per repository at call time, so there is no binding to keep in step
 * with what somebody later changes on GitHub.
 */
export const GITHUB_APP_SETUP_PATH = '/connect/github/setup'
