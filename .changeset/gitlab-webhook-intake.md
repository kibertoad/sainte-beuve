---
'@sainte-beuve/contracts': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': patch
'@sainte-beuve/worker': patch
'@sainte-beuve/local-server': patch
'@sainte-beuve/app': minor
---

GitLab merge requests drive the board the way GitHub pull requests do.

- A GitLab webhook posts to `POST /webhooks/gitlab/<org>` (and the default org's
  to `POST /webhooks/gitlab`), with the secret token the org stored as
  `gitlab-webhook-secret` on its GitLab configuration screen. The token is
  compared against digests, so the comparison does not depend on how much of it
  matches. The bare path answers 503 naming the setting; an org's path answers
  every unverified delivery with the same 403.
- Merge Request Hook: open and reopen track (a draft waits until it leaves
  draft), merge and close close, the review and AI-review labels route and
  delegate when added, `approved` settles and `unapproved` puts an approved
  review back on the clock. Note Hook: a mention of the bot runs the same
  commands as on GitHub, for people the org's reviewer directory knows by that
  GitLab handle. The bot is the account of the org's stored GitLab credential,
  and only when GitLab marks that account as a bot (a project or group access
  token, or a service account): a person's own token leaves commands off.
- `VcsAccount` gains `bot` and `StoredIntegrationToken` gains `subjectIsBot`,
  recorded when a credential is stored (migration `0011_integration_token_bot`
  on D1, and its Postgres twin). A GitLab token stored before this release reads
  as a person until it is stored again.
- A merge request first seen through a label or a comment has its author read
  from the host, as AI-review filing does, rather than recorded as `unknown`.
  An intent carries a null author where the payload names none, and a GitHub
  command records the pull request's author rather than the commenter.
- Merging or closing a merge request keeps a verdict it already has, as GitHub's
  close does.
- Only projects the org registered are acted on, as on GitHub.
- One label vocabulary for both hosts: `GitHubLabelRules` is now
  `ReviewLabelRules`, the container carries it as `labels` rather than
  `github.labels`, and `DEFAULT_GITHUB_LABELS` is `DEFAULT_REVIEW_LABELS`. The
  `GITHUB_LABEL_*` variables keep their names and now drive GitLab too.
- The intents and their handling are shared: `IntakeIntent` replaces
  `GitHubIntent`, and `ReviewIntake` performs what either host's delivery asks.
- `VcsConnection` gains `webhookPath`, and GitLab reports `inboundIntake`,
  `webhooksReady` and `botLogin` from the org's own secret and credential.
  `/health` reports `gitlabWebhooks` for the default org.
