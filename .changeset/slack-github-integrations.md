---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/app': minor
---

Wire GitHub and Slack end to end.

**GitHub, three ways to connect.** A GitHub App (installation tokens minted per
repository, RS256 on Web Crypto so the same code runs on workerd and Node), a
"Sign in with GitHub" round trip whose callback seals the resulting token, and a
personal access token pasted on the Configuration screen. Whichever are
configured are offered, and the strongest present is what calls are made with;
the order and the reason for each step are on `githubAuthMethodSchema`. There is
no installation table: an installation is resolved from the repository it is used
for and cached in memory.

**GitHub intake.** `POST /webhooks/github` verifies the signature over the raw
body and then acts: `pull_request` opens and closes a review, `pull_request_review`
resolves it, the review label routes it, the AI-review label delegates it to
cat-factory, a `skill:` label becomes a required skill, and a comment that
@-mentions the bot gets an answer on the pull request. A delivery this deployment
cannot verify is refused with a 503 naming `GITHUB_WEBHOOK_SECRET`.

**Slack, both directions.** New reviews are announced with buttons, and
`POST /webhooks/slack` serves the `/review` slash command (list, take, reroll,
snooze, ai) and those buttons behind Slack's request signing.

**Credentials resolve per request.** Each facade supplies one `GatewayFactory`,
so a credential entered in the SPA takes effect on the Worker and on the Node
service alike without a redeploy. A credential's status now reports whether it is
the one in force, which is a different fact from being stored: it can be shadowed
by a stronger credential or missing the rest of its configuration.

Breaking changes for anyone consuming these packages directly:

- `secretCipherFrom` is now `secretsFrom` and returns a state signer alongside
  the cipher (`SecretCipherWiring` is `SecretsWiring`).
- `AppContainer` carries `gateways`, `states`, `github` and `slack`;
  `announcementChannelId` moved onto `slack`.
- `GitHubVcsGateway` takes a `GitHubTokenSource` instead of a token string, and
  `octokit` is gone: the adapter is plain `fetch` over five endpoints.
- `StoredIntegrationToken` and `IntegrationTokenStatus` gained `subject`, and the
  pasteable integration ids are now `github-pat`, `slack-bot-token` and
  `cat-factory`.
- `reviewRequestFromPullRequestEvent` is replaced by `interpretGitHubDelivery`,
  which answers what a delivery MEANS across every event we read.
