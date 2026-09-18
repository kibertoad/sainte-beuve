# Security review

Date: 2026-09-18. Reviewed at commit `c1428ac` (`main`). Source review only; nothing
was run against a live deployment, and third-party packages were not audited beyond
their versions in `pnpm-lock.yaml`.

## Summary

The core of the design holds up. Sessions and API keys are 256-bit random values
stored as digests, the OAuth round trip is signed, expiring and bound to the browser
that started it, stored credentials are sealed under AES-GCM with a per-record key,
every D1 and Postgres statement on a tenant table carries `org_id`, webhook
signatures are checked over the raw body in constant time, and the role table in
[docs/orgs.md](./orgs.md) is enforced on every route it names. The list of sound
controls at the end of this document is long on purpose.

The weaknesses are at the edges of that design, and most of them share one root:
**membership of an org is not a decision anybody makes.** Any GitHub or GitLab
account can sign in to any org whose slug it knows, the first one in becomes its
admin, and a pre-registered reviewer row is handed to whoever signs in with a
matching username. Everything a `member` may do (read the board and the directory,
create reviews, trigger AI reviews, post findings to pull requests) is therefore
available to the public on a `required` deployment, and everything an `admin` may do
is available to whoever wins the first sign-in.

The other findings that need action before a shared deployment: a path-injection
into the GitHub API from a member-level route, no request body limit on the
unauthenticated webhook routes, the hosted deployment template shipping
`AUTH_MODE=open` (where anonymous is an admin), an OAuth callback URL derived from
the raw `Host` header, and `javascript:` URLs accepted where the SPA renders links.

| Severity      | Count |
| ------------- | ----- |
| High          | 6     |
| Medium        | 7     |
| Low           | 11    |
| Informational | 8     |

## Findings

Each finding cites the code it was verified against. Line numbers are as of the
reviewed commit.

### High

#### H1. Any host account can join any org, and the first one in becomes its admin

- `backend/packages/server/src/modules/auth/AuthController.ts:37-56` mounts
  `GET /api/v1/auth/sign-in/:provider?org=<slug>` under the `/api/v1/auth` prefix that
  `principal.ts` exempts from the `required` guard.
- `backend/packages/server/src/modules/connections/ConnectionsService.ts:235-246`
  resolves any existing slug with no membership check.
- `backend/packages/server/src/modules/identity/PeopleService.ts:26-33, 54-66` creates a
  reviewer row for any unknown account, and `roleForNewcomer` (`:118-121`) makes it
  `admin` when the directory is empty.

`docs/orgs.md` says a deployment that wants to control who may join "runs
`AUTH_MODE=required` behind an OAuth client scoped to its own people". On github.com
and gitlab.com no such scoping exists: any account can authorise any OAuth app. The
OAuth client id is public by construction, and `/health` advertises
`signInProviders`.

Attack: an operator creates org `acme` (`OrgService.create` makes no member). Before
the intended admin signs in, anyone who knows or guesses the slug completes the flow
with their own GitHub account and returns as `admin`: they can mint durable API keys,
connect their own credential as the org's, register repositories and edit the
directory. After a legitimate admin exists, every later stranger is still a `member`
with the board, the directory (names, Slack ids, handles), the registry, review
creation and AI-review dispatch. The same applies to the default org of a fresh
`required` deployment.

Fix: make joining an org an explicit act (an invite, an allow-list of host
subjects, or a per-org "open enrolment" flag that defaults off), and make the first
admin an operator decision (bootstrap through `AUTH_API_KEY`, or have `createOrg`
name the founding account) rather than a race.

#### H2. Handle-based adoption at first sign-in hands a pre-registered row, including its `admin` role, to whoever holds the username

`PeopleService.claim` (`backend/packages/server/src/modules/identity/PeopleService.ts:54-66`)
adopts an existing reviewer row when `isSameHandle(reviewer.handles[provider],
account.username)` matches. `isSameHandle` is a case-insensitive compare on the
username, not on the host's stable subject. The adopted row keeps whatever `role` an
admin typed on it (`createReviewerSchema` accepts `role`).

Attack: an admin pre-registers `{ handles: { github: "bob" }, role: "admin" }` before
Bob has signed in, which is the documented workflow ("a team registers people by
hand long before anybody signs in"). A typo, a renamed and re-registered GitHub
login, or simply the wrong Bob signs in and is bound to that row and its admin role,
permanently, because the `(provider, subject)` link is then the wrong subject.

Fix: adopt only by host subject, or make adoption an admin-confirmed step; at
minimum never adopt into a row whose role is `admin`.

#### H3. Registering a repository first captures another org's webhook traffic

- `backend/packages/server/src/modules/projects/ProjectService.ts:23-42` accepts any
  `{ provider, owner, repo }` from an org admin with no proof the org can reach it.
- `findOrgIdForProject` (Postgres `provider.ts:83-95`, D1 `provider.ts:168-178`)
  routes a delivery to the **oldest** claim across all orgs.
- `GitHubWebhookService.ts:96-100` rebinds the delivery to that org and then tracks
  the PR, assigns that org's reviewers, requests them on the PR and, on the AI label
  or a mention, delegates to cat-factory with that org's credentials.

Attack: tenants A and B share the deployment's GitHub App (one webhook secret, by
design). B's admin registers `acme/payments` before A does. Every PR event on A's
repository now lands on B's board, B's reviewers are requested on A's PRs, and A
can never take the claim back, because the `ConflictError` in `ProjectService.add`
only checks A's own org. The conformance case "the older claim on a repository is
the one an intake follows" encodes this as intended.

Fix: verify ownership at registration (the org's credential or installation can see
the repository), or route by GitHub `installation.id` rather than by `ref_key`; at
minimum refuse a registration that is already claimed by another org.

#### H4. `owner` / `repo` are interpolated unencoded into GitHub API paths from member-level routes

- `backend/packages/contracts/src/vcs.ts:63-64`: `pullRequestRefSchema.owner` and
  `.repo` are only `string`, `trim`, `minLength(1)`.
- `backend/packages/integrations/src/github/GitHubVcsGateway.ts:105, 117, 126` and
  `GitHubAppAuth.ts:129` build `/repos/${owner}/${repo}/...`; `client.ts:55` joins
  base and path with no encoding.
- `POST /api/v1/reviews` and `POST /api/v1/reviews/:id/assign`
  (`ReviewController.ts:27-30, 47-52`) carry no `requireAdmin`.

Attack: a member creates a review with
`repo: "x/../../../repos/victim/other/issues/1/comments?"` and calls `assign`.
`ReviewService.handOver` then issues `POST` and `DELETE` requests to the
attacker-shaped path with the org's GitHub credential (an installation token for the
parsed owner/repo, or the full-scope PAT or OAuth token). `fetch` normalises `..`,
and `?` truncates the fixed suffix, so the method, the path and the credential are
all chosen by the caller; only the body is constrained. GitLab is not affected
(`gitlab/client.ts` uses `encodeURIComponent`).

Fix: restrict `owner` and `repo` to the host's login alphabet in the contract
(`^[A-Za-z0-9_.-]+$`, no `..`) and `encodeURIComponent` each path segment in the
GitHub client. Check that `@cat-factory/sdk` encodes `runId` / `findingId` the same
way (it is not installed in this checkout, so this could not be verified).

#### H5. No request body limit; webhook bodies are buffered and HMACed before any size check

- `backend/packages/server/src/modules/webhooks/WebhookController.ts:25, 36`:
  `rawBody: await c.req.text()` on the unauthenticated `/webhooks/github` and
  `/webhooks/slack` routes.
- `backend/runtimes/node/src/index.ts:54`: `serve({ fetch: app.fetch, port })` with no
  `bodyLimit`, no `hono/timeout`, no rate limiting anywhere in the tree.

An unauthenticated client can stream very large bodies at the webhook paths (or any
JSON route) and the Node process buffers each into memory and runs an HMAC over it
before rejecting on signature. Workers are protected by the platform's body cap;
Node is not.

Fix: mount `hono/body-limit` in `createApp` (a few MB for webhooks, well under 1 MB
for JSON), and consider `hono/timeout` and a per-IP limiter in front of Node.

#### H6. The hosted deployment template ships `AUTH_MODE=open`, where anonymous is an admin

- `deploy/backend/wrangler.toml:72` sets `AUTH_MODE = "open"`; `deploy/node/.env.example`
  ships the same; `backend/runtimes/cloudflare/wrangler.toml:24` and
  `backend/runtimes/node/src/config.ts:176` default `CORS_ORIGINS` to `*`.
- `config.ts:204` and `cloudflare/src/container.ts:279` read any value other than the
  literal `required` (including a typo) as `open`.
- `principal.ts` `roleOf`: `if (principal.kind === 'anonymous') return 'admin'`.

`docs/auth.md` and `docs/orgs.md` document both decisions, and for a laptop they
are right. But the production-shaped template sets the value that makes every
reachable client an admin of the default org: with `curl` (the `Origin` guard only
stops browsers) it can replace the org's GitHub, GitLab, Slack and cat-factory
credentials with attacker-controlled ones, delete projects and reviewers, and
spend the cat-factory key. The only thing withheld from an anonymous caller is
minting an API key. Nothing refuses to boot on a public host with `open` and `*`.

Fix: ship `AUTH_MODE = "required"` in `deploy/backend/wrangler.toml` and
`deploy/node/.env.example`; refuse `open` at boot when `APP_BASE_URL` or
`CORS_ORIGINS` names a non-loopback origin, or at least log loudly; treat an
unrecognised `AUTH_MODE` value as a configuration error rather than as `open`.

### Medium

#### M1. The OAuth `redirect_uri` is built from the raw `Host` header

`AuthController.ts:44`, `ConnectionsController.ts:55` and `ConnectController.ts:83`
pass `new URL(c.req.url).origin`, and `ConnectionsService.callbackUrl` (`:398-400`)
builds the callback from it for both the authorize URL and the code exchange. On
Node, `c.req.url` comes from the request's `Host` header, so a client controls the
host in `redirect_uri`. GitHub matches `redirect_uri` on the registered host
excluding subdomains.

Attack: an attacker who controls any subdomain of the registered callback host (or
reaches a Node deployment whose proxy forwards arbitrary `Host`) starts the flow
with `Host: evil.api.example.com`, hands the authorize URL to a victim, receives the
code on their subdomain, and finishes the callback themselves with the flow cookie
they were issued. The nonce does not help because the attacker started the flow.
On the `connect` purpose the victim's token becomes the org's stored credential.
GitLab requires an exact-match redirect URI and is not affected.

Secondary effect: this path ignores `X-Forwarded-Proto` and `X-Forwarded-Host`,
while cookies and the origin guard honour them, so a Node deployment behind a TLS
terminator generates an `http://` redirect URI.

Fix: build the callback from a configured API base URL, or from `requestOrigin(c)`
behind a trusted-proxy check, and verify the host against an allow-list.

#### M2. `javascript:` URLs are accepted and rendered as links in the SPA

- `backend/packages/contracts/src/vcs.ts:67` (`pullRequestRefSchema.url`) and
  `projects.ts:34, 45, 55` (`webUrl`) use `v.url()`, which is `new URL()`-based and
  accepts `javascript:alert(1)`. `ai-review.ts:206` types `catFactoryUrl` as a bare
  nullable string.
- Rendered as `href` without filtering in `frontend/app/app/pages/board.vue:112`,
  `components/PullRequestList.vue:43, 55`, `components/AttentionInbox.vue:63, 101`,
  `pages/index.vue:162, 178`, `pages/projects.vue:132`, and
  `components/AiReviewRunCard.vue:190`.
- `POST /api/v1/reviews` and the attention routes are member-level and take the
  same schema.

Attack: a member creates a review whose `pullRequest.url` is a `javascript:` URL.
Every viewer who clicks it runs script in the SPA origin, which can call the API
with the victim's credentials (mint an API key as an admin, replace tokens). The
session cookie being `HttpOnly` does not help. There is no CSP (see L10). The same
field is also wrapped in a bot-vouched Slack link in the announcement channel, so
the phishing variant needs no click in the SPA at all. Whether NuxtLink sanitises
`href` was not verified against the installed `nuxt@4.5.2`; Vue itself does not.

Fix: constrain these schemas to `http:` or `https:` (ideally to the configured
GitHub or GitLab host for `pullRequest.url`), validate `catFactoryUrl` the same
way, and add a CSP.

#### M3. Any GitHub account able to comment on a watched repository can trigger paid runs, rerolls and review closure

`backend/packages/integrations/src/github/events.ts:197-227, 261-267`: `fromComment`
accepts a command from any `comment.user.login` other than the bot itself, with no
`author_association` or collaborator check; `fromReview` accepts `approved` from
any account. `GitHubWebhookService.runCommand` (`:196-212`) then dispatches to
cat-factory (`@bot ai`, a billed job) or withdraws the assigned reviewer via the
App token (`@bot reroll`); the `ai-review` label path (`:150-174`) does the same.

On a public repository with the App installed, any GitHub user can spend the org's
cat-factory budget in a loop, pull reviews off people, or close a tracked review
with a drive-by approval.

Fix: honour `author_association` (OWNER, MEMBER, COLLABORATOR) for commands, labels
and reviews; cap runs per PR per hour.

#### M4. Deliveries for unregistered repositories run in the default org

`GitHubWebhookService.ts:96-100`: when `findOrgIdForProject` returns null the
delivery executes against the unbound container, which is the default org. A
signed delivery for a repository nobody registered creates review rows, assigns the
default org's reviewers, mints installation tokens, comments, and (via M3) files
cat-factory runs on the default org's key. If the App is publicly installable,
anyone who installs it on their own repository gets this. `docs/orgs.md` documents
the fallback as the single-tenant convenience.

Fix: ignore deliveries for unregistered repositories, or make the fallback an
explicit opt-in.

#### M5. A paused reviewer can sign straight back in

`ReviewerService.ts:224-226` revokes sessions when `availability` becomes
`paused`, and `docs/orgs.md` presents that as the deployment's "not them, for now"
state. But `completeSignIn`, `PeopleService.refresh`, `SessionService.issue`,
`SessionService.resolve` and `roleOf` never consult `availability` (grep over
`modules/auth`, `modules/identity` and `modules/connections` finds no check). The
identity link survives the pause, so a paused person clicks "Sign in" and has a
fresh session with the same role; a paused admin can un-pause themselves.

Fix: refuse `establishSession` for a paused row and have `resolve` or `roleOf`
treat a paused row as refused.

#### M6. Slack: any workspace user can reroll, snooze or dispatch an AI review

`SlackWebhookService.ts:136-147, 182-199`: only `claim` maps the Slack user to a
reviewer row; `snooze`, `reroll` and `ai_review` run for any signed request, always
against the default org. The signature proves the request came from Slack, not who
typed it. Any workspace member (guests included, where the command is enabled) can
loop `/review ai <id>` to spend the cat-factory budget or `/review reroll <id>` to
pull reviews off people. The snooze argument is capped in `commands.ts`, so that
one is bounded.

Fix: require a directory row for the Slack user on every mutating command, and for
`reroll` require that they hold the review or are an admin.

#### M7. The cat-factory URL and upstream error text are posted to public pull requests

- `CatFactoryAiReviewGateway.ts:171` returns `${baseUrl}/tasks/${taskId}`;
  `githubReplies.ts:56-59` appends "Follow it at <url>" and
  `GitHubWebhookService.ts:185` posts it as a PR comment. On a public repository this
  discloses the (often internal, `http://localhost:8787` in local mode) cat-factory
  origin and task ids.
- `GitHubWebhookService.publicReason` (`:229-236`) maps only `unavailable`,
  `upstream_failed` and `internal` to fixed strings; `forbidden`, `not_found`,
  `conflict` and `validation` from `refusals.ts:449-471` pass through
  `getErrorMessage(err)`, which embeds the upstream response text and configuration
  hints ("rejected this deployment's API key", "`decide` scope").

Fix: omit the cat-factory URL from PR comments (keep it on the board), and map every
cat-factory-derived refusal to a fixed public string.

### Low

#### L1. The origin guard cannot see navigational or subresource GETs to the AI-review routes

`origins.ts:206-209` passes any request with no `Origin` header. Browsers send no
`Origin` on top-level navigations or on `<img>` / `<iframe>` loads, and on a
`SameSite=None` (split-host) deployment those carry the session cookie. A page
embedding `<img src=".../api/v1/reviews/<id>/ai-review">` therefore polls
cat-factory with the deployment's key and writes onto the run, which is exactly
the "GET that is not a read" the guard exists to refuse. The response is not
readable. Fix: make the poll a POST, or require `Sec-Fetch-Mode: cors` on the
guarded GET paths when a session cookie is present and `Origin` is absent.

#### L2. Org-slug oracle on the sign-in start route

`ConnectionsService.ts:244` answers 404 for an unknown slug and 200 for a known one
on an unauthenticated route with no rate limit. Reconnaissance for H1.

#### L3. Cookies do not use the `__Host-` prefix

`cookies.ts:159, 169`: `sb_session` and `sb_flow` are set with no `Domain` (good)
but nothing stops a page on a sibling subdomain from setting a `Domain=example.com`
cookie of the same name that the API then reads first. That enables session
fixation and a login-CSRF variant the nonce does not stop (the attacker plants
their own `sb_flow` before navigating the victim to the callback). Fix: name them
`__Host-sb_session` / `__Host-sb_flow` whenever `secure` is true; the attributes
already satisfy the prefix's rules.

#### L4. No rate limiting, and no minimum strength on `AUTH_API_KEY`

`container.ts:449` accepts any non-blank string as the environment key, which is
an admin credential of the default org compared on every bearer attempt
(`ApiKeyService.ts:104-118`). Minted keys and sessions are 256-bit and not
guessable; `AUTH_API_KEY=changeme` is. Fix: refuse (or warn on `/health` about) a
key shorter than 16 bytes, and throttle 401s per IP at the edge or in the facades.

#### L5. Member-level `resolve` posts findings and dispatches fixers to the real pull request

`AiReviewController.ts:54-58` mounts `resolveAiReviewContract` with no admin
check, and `AiReviewService.resolve` (`:226-238`) forwards `post` / `fix` to
cat-factory. Any member (which, per H1, is anyone who can sign in) can post
comments on, or commit to, any pull request in the org. Consider restricting to
the assigned reviewer or an admin.

#### L6. Credential envelopes are bound to the integration id only, not to the org

`IntegrationSettingsService.ts:70` and `connections/signIn.ts:50` seal with
`context = integrationId`. Tokens are keyed on `(org_id, integration_id)`, so an
envelope copied between two orgs' rows for the same integration decrypts, and the
AAD defence the port documents does not cover a cross-tenant row move by someone
with store write access. Include the org id in the context.

#### L7. Unbounded list endpoints and unbounded member-level writes

`GET /reviews`, `AttentionService.inbox`, `listReviewers`, `listProjects` and
`listAiReviewRuns` return everything with no page or limit; `PeopleService.claim`
and `handOver` call `reviewers.list()` on every use; members can create unlimited
reviews, asks and commitments. Bounded by org membership, which H1 makes cheap.

#### L8. SSE subscribers are unbounded

`AttentionController.ts:42-44` and `realtime/sse.ts:29-68` open one subscriber and a
25-second heartbeat timer per request with no per-principal cap.

#### L9. `/health` is unauthenticated and enumerates the security posture

`HealthController.ts:28-76` reports `auth.mode`, whether `AUTH_API_KEY` is set,
`signInProviders`, the store kind and every wired integration, and decrypts up to
three stored credentials per probe. No secret values are exposed; it tells an
attacker whether a target is `open` (H6) and which integrations exist. Consider a
bare `status` for load balancers and the detail block behind a credential.

#### L10. No security headers on either tier, and no `Cache-Control` on authenticated JSON

`app.ts` uses `hono/cors` only: no `secureHeaders()`, no `Cache-Control: no-store`
under `/api/v1` (only the SSE stream sets one). `frontend/app/nuxt.config.ts` and
`deploy/frontend` set no CSP, `X-Frame-Options` or `Referrer-Policy`, and there is
no `_headers` file for Pages. M2 has no backstop as a result.

#### L11. CI actions are pinned by major tag, not by commit SHA

`.github/workflows/ci.yml:30-34` and repeats use `actions/checkout@v5`,
`pnpm/action-setup@v4`, `actions/setup-node@v5`. Everything else in the workflow is
sound (`permissions: {}`, `persist-credentials: false`, no `pull_request_target`).

### Informational

- **I1. A new sign-in does not revoke the previous session in the same browser.**
  `ConnectController.ts:73-89` overwrites the cookie but never deletes the row, so
  an earlier stolen cookie stays valid until absolute expiry.
- **I2. `X-Forwarded-Proto` / `X-Forwarded-Host` are trusted from any caller.**
  `forwarded.ts` has no trusted-proxy list. Every current consumer is self-limiting
  (a forged value only affects the forger's own cookie or write), and a browser
  cannot attach the header to a simple request, so this is not exploitable today.
  Any new consumer of `requestOrigin()` has to keep that property, and M1 shows the
  inverse mistake already exists.
- **I3. The guard exemption is a bare prefix.** `principal.ts` `OPEN_PREFIX =
'/api/v1/auth'` with `startsWith` would also exempt a future `/api/v1/authors`.
  Use `'/api/v1/auth/'`.
- **I4. Session and API-key `create` trust the payload's `orgId`.** D1 `auth.ts:57-77,
164-177` and Postgres `auth.ts:169-172, 223-226` insert `session.orgId` /
  `key.orgId` as passed, unlike every other table which writes `this.orgId`. Both
  callers copy `container.orgId` today, and the conformance suite passes a matching
  value in every fixture, so a divergence would not be caught. Overwrite with
  `this.orgId` in all three stores and add a case.
- **I5. Slack `response_url` is not host-validated.** `commands.ts:72, 136` and
  `respond.ts:263` POST to it verbatim. Safe while the signing secret holds; require
  `https://hooks.slack.com/`.
- **I6. Prompt-injection surface into the AI reviewer.** PR title, `pullRequest.url`
  and member-supplied `instructions` (up to 2000 chars) reach the model prompt
  (`CatFactoryAiReviewGateway.ts:179-188`). Mitigation belongs mostly in cat-factory.
- **I7. Slack error replies echo operator-oriented messages.**
  `SlackWebhookService.ts:118` returns `requireCapability` and cat-factory refusal
  text to any workspace user. Ephemeral and signed; documented as intentional.
- **I8. Runtime and supply-chain notes.** The Node facade listens on all
  interfaces (`index.ts:54` passes no hostname), which with H6 exposes a laptop's
  open deployment to the LAN. `drizzle-orm` / `drizzle-kit` run a `1.0.0-rc.4`
  release candidate in production (documented and pinned exact). The Dockerfile's
  `corepack enable` resolves pnpm from `packageManager` with no integrity hash.

## Controls that are sound

Checked and found correct; listed so the reader knows they were looked at.

- **Bearer credentials.** 32 random bytes from `crypto.getRandomValues`, `sbs_` /
  `sbk_` prefixes, stored as unkeyed SHA-256 with a 4-character hint
  (`crypto/tokens.ts`). Expired sessions are refused and deleted on read and swept
  by the tick. `AUTH_API_KEY` is compared with a length-independent
  `timingSafeEqual` (`kernel/src/encoding.ts:45-49`) before the prefix check. Only
  the mint route returns a secret; `apiKeyOnTheWire` / `sessionOnTheWire` are
  explicit field lists.
- **Session cookie.** `HttpOnly; Path=/; SameSite=Lax|None; Secure`, `maxAge`
  matched to the row, `None` always forces `Secure`, cleared with identical
  attributes. The SPA never stores a token; the API client and `EventSource` use
  `credentials: 'include'`.
- **OAuth round trip.** State is HMAC-SHA-256 under an HKDF-derived key with a
  10-minute expiry, flow binding, a required nonce and fail-closed parsing; the
  nonce is paired with an `HttpOnly` flow cookie compared in constant time and
  spent before the state is checked; `returnTo` is minted server-side from
  `appBaseUrl` only, so there is no open redirect; the org slug rides in the signed
  state, not the callback URL.
- **CORS and CSRF.** `Access-Control-Allow-Credentials` only beside a named origin;
  the wildcard never covers unsafe methods, `/api/v1/settings*` or AI-review
  reads; loopback is echoed only when both ends are loopback; `writeOriginGuard`
  refuses cross-site simple-request writes and `Origin: null`.
- **Middleware order.** `allowCredentials → cors → container → writeOriginGuard →
authentication → routes`, all registered before any `app.route`.
- **Secrets at rest.** AES-256-GCM with a per-record HKDF-derived key (random
  16-byte salt), random 12-byte IV, versioned envelope with a derived key id,
  context bound as AAD, structure validated before any key is touched, master key
  of at least 32 bytes enforced. No hardcoded or fallback keys anywhere; local mode
  generates a per-boot key for its in-memory store. No token is ever returned by a
  settings read; `CredentialField.vue` is write-only.
- **Tenancy.** `authentication()` rebinds the container with `withOrg`; no route
  contract accepts an org id; no repository port method takes one; `TenancyDirectory`
  is exactly the three documented reads; every D1 and Postgres statement on a
  tenant table includes `org_id` (read line by line); the in-memory store hands each
  org its own dataset; the attention bus is scoped per org; the reminder tick
  builds a scoped container per org without mutating the boot container. Session
  and key digests are globally unique in both dialects.
- **SQL.** D1 uses `prepare().bind()` throughout; Postgres goes through Drizzle
  with `eq` / `and` / `inArray`; no caller-supplied `ORDER BY`, column names or
  `LIKE` patterns anywhere.
- **Roles.** `requireAdmin` is on every route the role table marks admin-only;
  the role is read off the reviewer row per request so demotion is immediate;
  keys carry their own role chosen at mint by an admin; `role` appears only in the
  admin-only reviewer schemas; valibot strips unknown keys on member routes.
  Attention and workspace routes derive the actor from the session and refuse API
  keys; `cancel` / `release` / `commit` check ownership; foreign ids are 404.
- **Webhooks.** HMAC-SHA-256 over the raw body, `sha256=` prefix checked, constant-time
  compare, Slack 5-minute replay window against the injected clock, raw body used
  before form decoding, missing secret answered with 503 rather than an unsigned
  path, verification before `JSON.parse`. Bot's own comments are ignored in both
  login forms; the mention regex escapes the login.
- **GitHub App.** RS256 JWT with backdated `iat` and 9-minute `exp`, key imported
  once and non-extractable, PKCS#1 refused with guidance, installation tokens cached
  in memory only with expiry skew.
- **Outbound.** Slack mrkdwn is escaped and link URLs percent-encoded; GitHub,
  GitLab, Slack and cat-factory origins come from operator configuration only, so
  there is no user-controlled SSRF base; cat-factory calls carry a 20-second
  deadline.
- **Errors and logs.** Unknown errors return `Unexpected error`; upstream messages
  carry a status and path but never a token; all 27 logger call sites log ids,
  errors and presence flags only; tokens travel in headers, never query strings.
- **Supply chain and CI.** Single lockfile, `--frozen-lockfile`, no git or URL
  dependencies, `minimumReleaseAge: 1440` with one documented exclusion, an
  `allowBuilds` allow-list for postinstall scripts, `permissions: {}` and
  `persist-credentials: false` in CI, multi-stage Docker image running as `node`
  with `--ignore-scripts`. No dependency version matched a known-vulnerable range.

## Test coverage gaps

- No test that an unknown host account is refused (there is no such rule), that
  the first sign-in in `required` mode becomes admin and the second a member, or
  that a paused reviewer cannot re-sign-in.
- No test for adoption into a pre-registered row by handle, or that an admin row is
  never adopted.
- No test that a review with a malformed `owner` / `repo` is refused, nor for
  cross-org repository claims beyond "the older claim wins".
- No direct unit tests for `HmacStateSigner` (expired, tampered, missing nonce,
  wrong flow) or for `timingSafeEqual`; no test that `Origin: null` is refused, nor
  for an `Origin`-less GET on an AI-review path with a session cookie.
- No test that re-sign-in revokes the prior session, that `sb_flow` is `HttpOnly`,
  or that neither cookie carries `Domain`.
- Conformance does not cover cross-org `update` / `touch` on reviews, attention,
  runs, projects, reminders, sessions and keys, cross-org single-id `delete` on
  projects, commitments and sessions, or `sessions.create` / `apiKeys.create` called
  on `forOrg(A)` with a payload naming org B.

## Suggested order of work

1. **Membership** (H1, H2, M5): an explicit join rule, subject-based adoption,
   operator-chosen first admin, paused rows refused at sign-in. Most other member-
   level findings shrink once "member" means something.
2. **Input shape** (H4, M2): tighten `owner` / `repo` and the URL schemas in
   `@sainte-beuve/contracts`, encode GitHub path segments.
3. **Deployment defaults** (H6, H5, L10): `required` in the templates, a body limit
   and security headers in `createApp`.
4. **Webhook routing and gating** (H3, M3, M4, M6): ownership at registration,
   `author_association`, drop unregistered deliveries, map Slack users to rows.
5. **Callback URL** (M1) from configuration rather than `Host`.
6. **Disclosure** (M7, L9, L2) and the remaining Low and Informational items.
