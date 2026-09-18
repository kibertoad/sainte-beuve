---
'@sainte-beuve/contracts': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

A Slack app belongs to an org, so a slash command reaches the board it is for.

A GitHub delivery names a repository and the project registry places it. A slash
command named a Slack user and a channel, which place nothing, so every command
acted on the default org — the one surface the tenancy boundary did not reach.

- The Slack Request URL carries the org's slug (`POST /webhooks/slack/<org>`), and
  the bare `POST /webhooks/slack` keeps meaning the default org. Naming an org
  buys nothing on its own: there is no credential on an inbound Slack request
  until the secret that slug selects has verified it, so a stranger can write any
  slug and cannot sign for it.
- The signing secret is now an org's CREDENTIAL rather than deployment wiring:
  `slack-signing-secret`, in the same sealed per-org store as the bot token,
  entered on the Configuration screen and resolved per request. `/health` and the
  connections read resolve it too, instead of reporting the process environment.
- The deployment's own Slack app is the DEFAULT org's, and all three parts of it
  stay there: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`
  describe one app in one workspace, so none is lent to a named org. Lending the
  secret would let anybody who can sign for that app act on every tenancy by
  writing a slug in a URL; lending the other two would post a named org's review
  titles, URLs and reviewer names through the deployment's bot into the
  deployment's channel. A named org connects its own Slack app or has no Slack at
  all, and its Configuration screen says so.
- Every refusal on `/webhooks/slack/<slug>` before a verified signature is the
  SAME refusal — one 403, one body — whether the slug names nothing, names an org
  with no secret stored, or names one whose secret does not match. A 404 for one
  and a 503 for another would let an anonymous POST read this deployment's
  tenancy list out one guess at a time. The bare `/webhooks/slack` keeps its 503
  naming `SLACK_SIGNING_SECRET`, because nobody named a tenancy there.
- The secret-free half of verification runs FIRST: both headers present and the
  timestamp inside the replay window is a string compare, where placing the
  delivery is a store read and opening the org's secret is another plus an HKDF
  derivation and an AES-GCM open. An unsigned or replayed POST to this
  unauthenticated route now costs neither.
- `OrgService.bySlug` is now the one rule for what a slug in an unauthenticated
  path means, asked by both the sign-in and the intake, so the two cannot
  disagree about which board somebody landed on.

A deployment that never made a second org is entirely inside the default one and
needs no change in Slack.
