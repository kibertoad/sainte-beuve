---
'@sainte-beuve/contracts': minor
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
- `SLACK_SIGNING_SECRET` survives as the DEFAULT org's fallback and is
  deliberately not lent to a named org: it belongs to the deployment's own Slack
  app, and lending it would let anybody who can sign for that app act on every
  tenancy by writing a slug in a URL. A named org with nothing stored is refused,
  naming the credential to store.
- `OrgService.bySlug` is now the one rule for what a slug in an unauthenticated
  path means, asked by both the sign-in and the intake, so the two cannot
  disagree about which board somebody landed on.

A deployment that never made a second org is entirely inside the default one and
needs no change in Slack.
