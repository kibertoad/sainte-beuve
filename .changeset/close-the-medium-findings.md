---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Close the seven medium findings of [docs/security-review.md](../docs/security-review.md).

- M1: the OAuth callback is built on the new `API_BASE_URL` (both facades, both
  templates, reported as `auth.apiBaseUrl` on `/health`), never on the request's
  `Host`. Without it a sign-in starts only on a loopback host. The callback
  derives its redirect URI only after the state verifies, so a forged callback
  learns nothing about the configuration.
- M2: `webUrlSchema` holds `pullRequest.url`, a project's `webUrl` and a run's
  `catFactoryUrl` to `http` or `https`, and the SPA renders every stored link
  through `safeHref` (`isWebUrl`), so a row written before the rule is still not
  a `javascript:` link.
- M3: comment commands and submitted reviews are acted on only from an `OWNER`,
  `MEMBER` or `COLLABORATOR` (`isTrustedAssociation`); a stranger's mention gets
  silence. Every way to file an AI review meets `decideAiReviewAdmission`: one
  run in flight per review, at most three filed an hour.
- M4: a GitHub delivery for a repository no org registered is acked as
  `ignored:unregistered` and dropped, the default org included.
- M5: a paused directory row is refused at the end of every sign-in, and
  `roleOf` reads one as no admin.
- M6: every Slack command that writes needs a directory row for the Slack user,
  refuses a paused one, and a reroll comes only from whoever holds the review or
  an admin (`decideChatCommand`).
- M7: the bot's pull-request comment no longer links to cat-factory, and a
  refusal cat-factory wrote (marked `{ upstream: 'cat-factory' }`, read with
  `upstreamOf`) becomes one fixed sentence on the pull request.

Breaking: a hosted deployment must set `API_BASE_URL` before anybody can sign in;
a single-tenant deployment must register its repositories on the Projects screen
before GitHub deliveries for them do anything; bot commands and approvals from
outside the repository's own people are ignored; and a stored row whose link is
not `http(s)` now fails to decode on the durable stores, naming its table and id.
