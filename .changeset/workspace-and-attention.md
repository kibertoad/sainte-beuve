---
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Add the workspace: the three lists one person has to act on, the projects behind
them, and a way to ask the team for attention on a pull request.

`GET /api/v1/workspace` sweeps every registered project once per host and cuts
the result three ways: what you have out, what the host has asked you to review,
and what you promised to review here. A project that cannot be read is reported
beside the others rather than failing the call, because a deployment holding one
host's credential and not the other's is the normal state.

**Asking for attention.** `POST /api/v1/attention` raises an ask against a pull
request with the skills a reviewer needs (from the project's own vocabulary), an
optional same-team gate, and how many people it is waiting for. It is delivered
two ways with the same payload: pushed over server-sent events to a page already
open (`GET /api/v1/attention/stream`), and fetched by a page opened later
(`GET /api/v1/attention`). Reaching the critical mass resolves it and withdraws
it from every inbox, including the people who never answered.

**GitLab, behind the same port as GitHub.** Both hosts are now adapters behind
one `VcsGateway`, resolved per host from that host's own credential. GitLab
brings listing, reviewer changes, comments, the account read and a sign-in;
configure a self-managed install with `GITLAB_BASE_URL`, which serves the API
and the OAuth endpoints together.

**An identity is not a login.** A person is a reviewer row, and the accounts
they are known by are `(provider, subject)` rows keyed on each host's stable id,
so a rename keeps somebody's workspace and one person can hold a GitHub and a
GitLab account at once. Until sessions land, the viewer is whoever the
deployment's source-control credential acts as.

Breaking changes to the published packages:

- `Reviewer.githubLogin` is now `Reviewer.handles`, a handle per host
  (`{ github, gitlab }`). Every place that mirrors an assignment or matches an
  author asks for the handle belonging to the pull request's own host.
- `Reviewer` gains `team`, which the same-team attention gate reads.
- `GatewayFactory` takes a provider: `vcsFromToken(provider, token)`,
  `vcsAsApp(provider)` and `signIn(provider)` replace the GitHub-named members.
  `resolveVcs(container, provider)` likewise.
- `VcsGateway.identify()` answers a `VcsAccount` (stable subject plus handle)
  rather than a login string, and gains `listOpenPullRequests(project)`.
  `VcsIdentityGateway.exchangeCode` answers an account too.
- `AppContainer.vcs` is a record of one gateway per host, and the container
  carries an `AttentionBus`.
- `Connections.github` is now `Connections.vcs`, one entry per host, and
  `githubAuthMethodSchema` / `githubConnectionSchema` are
  `vcsAuthMethodSchema` / `vcsConnectionSchema`.
- The sign-in routes take the host: `/settings/connections/:provider/sign-in`.
- `GITHUB_OAUTH_CREDENTIAL_KEY` is replaced by `vcsOauthCredentialKey(provider)`,
  and `gitlab-pat` joins the pasteable integration ids.
- `isSameGithubLogin` is now `isSameHandle`.
- `/health` reports `capabilities.vcs` per host rather than as one boolean.
- The SPA serves the workspace on `/`; the review board moves to `/board`.
