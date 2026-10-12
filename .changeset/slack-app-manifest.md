---
'@sainte-beuve/contracts': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

The Slack Configuration screen generates the org's Slack app manifest.

- `GET /api/v1/settings/connections/slack/manifest` (admin only) returns a manifest
  for the caller's org: the `/review` command and interactivity point at the org's
  `/webhooks/slack/<slug>` on `API_BASE_URL`, the Messages tab is on and takes
  `/review`, and the bot scopes are `chat:write`, `chat:write.public` and
  `commands`. A deployment with no https `API_BASE_URL` gets a sentence naming
  what to set instead.
- `slackAppManifest` and `SLACK_BOT_SCOPES` in `@sainte-beuve/integrations` build it.
- The screen shows the manifest with a copy button above the bot token and signing
  secret fields, and its Request URL line quotes the manifest's URL when there is
  one.
