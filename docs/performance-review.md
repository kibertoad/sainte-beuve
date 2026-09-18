# Performance review

A read-only pass over the whole tree, September 2026, looking for the places
that will scale badly with pull requests, reviewers, orgs and open tabs. With
one exception (finding 2) nothing here is a correctness bug; every finding is
about what a deployment pays as it grows. Line numbers are against the tree at
the time of writing.

The short version: the request path is lean, the durable stores are indexed for
every read they make, and the traps that usually cost the most (a KDF per
request, a container rebuilt per request, an unguarded interval) are already
avoided and say why. What is left clusters in four places:

1. **The reminder tick** is strictly serial across orgs and across reminders,
   with a fixed cost per idle org and seven store round trips per nudge, and it
   sends before it marks, with no claim a second process would respect.
2. **Two reads are unbounded**: `GET /reviews` returns every review the org has
   ever tracked, and the reviewer directory is loaded whole to find one person.
3. **Outbound HTTP has no deadline** on GitHub, GitLab or Slack, so one stalled
   upstream holds a workspace read or a whole tick.
4. **The SPA serialises its first paint**: the shell awaits the auth read
   before any page can start its own, and every page awaits its data, so a
   route change shows nothing for two round trips.

Each finding names the file, what the code does, why it costs, and the smallest
fix that respects the rules in [CLAUDE.md](../CLAUDE.md): a port change lands in
all three stores with a conformance case, a new indexed column gets a migration
per dialect, and the runtimes stay symmetric.

## Priority

| #   | Finding                                                      | Impact      | Port change |
| --- | ------------------------------------------------------------ | ----------- | ----------- |
| 1   | Reminder tick is serial everywhere                           | High        | no          |
| 2   | Reminder is sent before it is marked, with no claim          | High        | yes         |
| 3   | `GET /reviews` is unbounded and includes closed history      | High        | yes         |
| 4   | SPA first paint is a request waterfall that blocks the page  | High        | no          |
| 5   | No fetch deadline on GitHub, GitLab, Slack                   | Medium-High | no          |
| 6   | Reviewer directory scanned whole to find one person          | Medium      | yes         |
| 7   | A labelled `opened` webhook schedules the reminder twice     | Medium      | no          |
| 8   | Every `update()` is a read then a full-row upsert            | Medium      | no          |
| 9   | GitHub App token minting has no in-flight de-duplication     | Medium      | no          |
| 10  | Board reads poll cat-factory with no minimum interval        | Medium      | no          |
| 11  | SPA polling and SSE ignore tab visibility; cache is implicit | Medium      | no          |
| 12  | Same credential opened twice in one webhook request          | Medium      | no          |
| 13  | GitLab reviewer changes: N user lookups per change, no cache | Medium      | no          |
| 14  | Worker cron is hourly, Node interval is a minute             | Medium      | no          |
| 15  | Node server on defaults: keep-alive, body limit, pool        | Low-Medium  | no          |
| 16  | `review_commitments.find` not covered by its index           | Low-Medium  | migration   |
| 17  | `review_requests` ordering has no index without a status     | Low-Medium  | migration   |
| 18  | Outstanding counters adjusted one statement at a time        | Low-Medium  | optional    |
| 19  | `/health` and the settings screen open every credential      | Low-Medium  | no          |
| 20  | Icons probably fetched at runtime on the static deploy       | Low-Medium  | no          |
| 21  | Full PR objects fetched for six fields                       | Low         | no          |
| 22  | Smaller items                                                | Low         | mixed       |

## 1. The reminder tick is serial across orgs and across reminders

`backend/packages/server/src/reminders/tick.ts:93-101`, `:154-165`, `:217-233`.

```ts
for (const pass of passes) pass.nudges = await sendDue(pass.container, batchSize)
for (const pass of passes) pass.passengers = await ridePassengers(pass.container, batchSize)
// ...
for (const reminder of due) {
  const outcome = await deliver(container, reminder, chat)
```

**What it does.** One pass lists every org, then walks them one at a time, and
inside each walks up to fifty due reminders one at a time. An idle org still
costs three store round trips (`listDue`, `deleteExpired`, `listInFlight`). A
due reminder costs `reviews.getById`, `reviewers.getById`, one Slack call,
`reminders.updateStatus` (a SELECT then an upsert on both durable stores), then
`scheduleNextReminder`: two parallel list reads, `cancelScheduledForReview` (a
SELECT then a batch upsert) and `create`. That is roughly seven store round
trips and one outbound HTTP call per nudge, none overlapping.

**Why it costs.** On D1 each statement is a network hop of several
milliseconds, so fifty nudges in one org is on the order of fifteen seconds
before the second org is looked at. The Node clock skips a tick that overruns
its interval (`backend/runtimes/node/src/clock.ts:25-37`), and a skipped tick
delays the reminders that caused it, which is positive feedback. The Worker's
`scheduled` invocation has a wall-clock budget the same loop has to fit inside.
The ordering that puts every org's nudges before any org's passengers is right
and worth keeping; it is the fan-out, not the reads, that is the problem. The
reads themselves are exactly what the indexes serve.

**Fix.**

- Bounded concurrency inside one org's batch: a small pool (four or five in
  flight) around `deliver`. The rows are independent and Slack tolerates a
  handful of parallel posts. Keep `resolveChat` once per org as it is.
- Bounded concurrency across orgs for each of the two walks, awaiting the whole
  nudge walk before the passenger walk starts, so the ordering holds.
- Run the session sweep every Nth tick rather than every tick; the doc comment
  already says it is not about correctness.
- Batch the per-reminder lookups: after `listDue`, load the distinct review ids
  and reviewer ids in one read each. That needs a `getByIds` on the two ports
  (all three stores, one conformance case) and is the step to take when the
  batch cap is regularly hit.
- `orgs.list()` is itself unbounded and is read every minute; a `listIds` or a
  cursor keeps the tick's fixed cost flat as tenancies grow.

## 2. A reminder is sent before it is marked, and nothing claims it

`backend/packages/server/src/reminders/tick.ts:217-233` and `:266-276`.

**What it does.** `deliver` calls `sendReminder` and only then `updateStatus`,
and `updateStatus` on both durable stores is an unconditional read-then-write
with no `WHERE status = 'scheduled'`. The only guard against two passes over
the same rows is process-local (`oneAtATime` on Node), and the Worker comment
says plainly it has none.

**Why it costs.** Two Node replicas, or a Worker cron firing while the previous
invocation is still inside `waitUntil`, both read the same fifty rows and both
post. A crash between the Slack call and the mark re-sends on the next tick.
The cost is a duplicated nudge per reminder, and it only appears under the load
that a horizontally scaled deployment is bought for.

**Fix.** One port method, `reminders.claim(id, now): Promise<boolean>`, a
conditional update in all three stores (`UPDATE ... SET status = 'sending'
WHERE ... AND status = 'scheduled'`, returning whether a row changed; a
check-and-set in memory) with a conformance case, and `deliver` skips what it
could not claim. `tick.ts` is shared, so the facades need no change. This is
the one item here that is a correctness fix as much as a performance one.

## 3. `GET /reviews` returns every review the org has ever tracked

`backend/packages/server/src/modules/reviews/ReviewController.ts:23`,
`backend/packages/kernel/src/ports/repositories.ts:76`,
`backend/packages/persistence-postgres/src/reviews.ts:37-54`,
`backend/packages/persistence-d1/src/reviews.ts` (same statement).

```ts
const reviews = await c.get('container').repositories.reviews.list()
```

**What it does.** The board route calls `list()` with no filter, and `list()`
has no `LIMIT`. Terminal reviews (`approved`, `changes_requested`, `closed`)
never leave the table; there is no archive on the port. Every row's payload is
JSON-decoded and then valibot-parsed (`rows.ts:decodeData` on D1,
`schema.ts` `fromDriver` on Postgres).

**Why it costs.** The response and the CPU spent parsing it grow linearly with
history and never shrink. A board polled by every open tab is slower each week.
On the Worker that CPU is billed. The Slack `/review list` already does the
right thing (`SlackWebhookService.ts:163-172`): it filters to the three active
statuses at the store.

**Fix.**

- Add `status` (and a `limit`) to `listReviewsContract`; the port already takes
  `{ status }`. Default the SPA's board to the active statuses.
- Add `limit` to `ReviewRequestRepository.list` in all three stores, with a
  keyset cursor on `(createdAt, id)` if paging is wanted; the ordering is
  already total, so the cursor is `WHERE (created_at, id) < (?, ?)` on both
  engines.
- Pair it with the index in finding 17 so the ordered, limited read is an index
  scan.

## 4. The SPA's first paint is a request waterfall that blocks the page

`frontend/app/app/app.vue:27-28`, and `await useAsyncData(...)` at the top of
`pages/index.vue:14`, `board.vue:14`, `projects.vue:15`, `reviewers.vue:19`,
`configuration.vue:26`.

```ts
const auth = useAuthState()
await auth.refresh()
```

**What it does.** The root component suspends on `GET /auth` before
`<NuxtPage>` mounts, and only then does the page's own `useAsyncData` start.
Each page awaits its data at setup, so Suspense holds the previous screen until
the fetch resolves, is validated through valibot and is mounted. The
Configuration page adds a third hop: it awaits `auth.refresh()` again before
its three parallel reads.

**Why it costs.** With `ssr: false` there is no hydration to protect, so the
await buys nothing. First paint of any screen is two sequential round trips
plus a CORS preflight, three on Configuration, and a click on "Board" gives no
feedback until the whole list is down. Nothing in the pages needs the auth
answer to issue their fetch; the shell only renders a name from it.

**Fix.**

- In the shell, `void auth.refresh()` or `useAsyncData('auth', ..., { lazy:
true })`; the `whoami` computed already tolerates null.
- On Configuration, reuse the auth state already held (`if (auth.state.value
=== null) await auth.refresh()`).
- `lazy: true` on the page reads, with a skeleton while `pending && !data`.
  `AiReviewPanel.vue:17-21` already does exactly this and says why.
- `<link rel="preconnect">` to the API origin in `app.head` so the TLS
  handshake and preflight overlap the bundle download.

## 5. No deadline on any GitHub, GitLab or Slack request

- `backend/packages/integrations/src/github/client.ts:58-68`
- `backend/packages/integrations/src/gitlab/client.ts:265-274`
- `backend/packages/integrations/src/slack/SlackChatGateway.ts:62-69` and
  `slack/respond.ts:171-175`
- the OAuth code exchanges in both identity gateways

**What it does.** None of these `fetch` calls carry a `signal`. The cat-factory
transport does it right (`ai-review/src/CatFactoryAiReviewGateway.ts:64-85`):
`AbortSignal.timeout(20_000)` combined with any caller signal, with a comment
explaining that a sequential sweep inside one cron invocation cannot afford one
hung upstream.

**Why it costs.** The same argument applies verbatim to the other three hosts.
The tick awaits `sendReminder` per reminder inside the cron, so one stalled
Slack connection holds the whole pass and on the Worker eats the invocation.
The workspace read fans `listOpenPullRequests` out with `Promise.all`, so one
hung GitHub connection holds the user's whole screen.

**Fix.** Lift the deadline helper out of the ai-review package into a shared
place (kernel or integrations) and apply it in `githubRequest`,
`gitlabRequest` and both Slack posters. While there, read `retry-after` and
`x-ratelimit-reset` on a 403 or 429 and attach them to the error; nothing reads
those headers today, so a secondary rate limit from GitHub surfaces as a generic
project failure with no useful message.

## 6. The reviewer directory is loaded whole to find one person

**Slack claim.** `backend/packages/server/src/modules/webhooks/SlackWebhookService.ts:181-182`:

```ts
const reviewers = await this.container.repositories.reviewers.list()
const reviewer = reviewers.find((candidate) => candidate.slackUserId === slackUserId)
```

This runs inside Slack's three-second response window on every "I will take
it". It decodes every reviewer payload to match one column.

**First sight of an unlinked account.**
`backend/packages/server/src/modules/identity/PeopleService.ts:56-58` does the
same scan on the handle. This one is narrower than it looks: `reviewerFor`
(`:23-30`) asks `identities.findReviewerId` first, which is a primary-key read,
so the scan only runs the first time an account is seen. But `roleForNewcomer`
then lists the whole directory a second time to test whether it is empty, and
the comment notes one page load fires three of these at once.

**Selection.** `ReviewService.ts:142` lists the directory for every assign and
reroll. That one is legitimate: selection is over the whole pool.

**Why it costs.** Linear in reviewer count on every Slack interaction and on
every first sign-in. With a few hundred reviewers and a payload parse per row
it is the dominant cost of the request.

**Fix.**

- `ReviewerRepository.findBySlackUserId` in all three stores, backed by an
  indexed `slack_user_id` column (a migration per dialect). Alternatively store
  a Slack identity row in `identities` under `provider = 'slack'` and reuse
  `findReviewerId`; that fits the existing key and needs no schema change.
- `ReviewerRepository.count()` (or `isEmpty()`) for `roleForNewcomer`.
- `findByHandle(provider, handle)` is the third method, if first-sight cost ever
  matters; a normalised handle column is what would index it.

## 7. A labelled `opened` webhook schedules the reminder twice

`backend/packages/server/src/modules/webhooks/GitHubWebhookService.ts:128-140`,
`ReviewService.ts:53` and `:232`, `reminders/schedule.ts`.

**What it does.** `track` creates the review, and `create` ends with
`scheduleNextReminder`. The webhook then calls `assign`, and `recordAssignment`
ends with `scheduleNextReminder` again. Each call is two parallel list reads,
`cancelScheduledForReview` (SELECT then batch upsert) and `create`, so the row
the first call wrote is cancelled a few milliseconds later by the second.

**Why it costs.** This is the most common webhook, and it runs inside GitHub's
delivery request. The double plan roughly doubles the store work of it.

**Fix.** Let `create` take `{ schedule: boolean }`, or have `track` skip the
plan when the caller is about to assign. The decision of what to schedule stays
in `@sainte-beuve/reminders`; only the service ordering changes.

## 8. Every `update()` is a read then a full-row upsert

Postgres `reviews.ts:88-94` is the shape every payload store uses:

```ts
const current = await this.getById(reviewId)
if (current === null) return null
const next = patched(current, patch)
await this.write(next) // INSERT ... ON CONFLICT DO UPDATE SET <every column>
```

Same at `reviews.ts:281-287` (AI runs), `attention.ts`, `workspace.ts`,
`reviewers.ts`, `orgs.ts`, and their D1 twins. `ReminderRepository.updateStatus`
is the same: SELECT, decode, re-encode, upsert.

**Why it costs.** Two round trips where one would do, and on D1 each is a
network hop. The whole payload is re-serialised and every index column is in
the SET list, so a one-field patch rewrites the tuple and every index entry on
it (Postgres does not skip unchanged columns). There is no version guard, so two
concurrent patches on one review (a webhook and a UI click, or the tick's
`sweepOne` interleaving with a curation call) silently drop one.

**Fix.**

- Add an optimistic guard: the payloads already carry `updatedAt`, so
  `WHERE ... AND data->>'updatedAt' = ?` on Postgres and
  `json_extract(data, '$.updatedAt') = ?` on D1, returning null on zero rows.
  A conformance case with two overlapping patches, one losing. This is the
  smaller change and is a correctness win as much as a performance one.
- For `updateStatus` specifically, which touches three fields, a single
  `UPDATE reminders SET status = ?, data = json_set(data, ...)` is one trip on
  both engines and keeps the column and the payload in step.

## 9. GitHub App token minting has no in-flight de-duplication

`backend/packages/integrations/src/github/GitHubAppAuth.ts:236-261`.

**What it does.** Both caches (`owner/repo → installation id`, and
`installation id → token`) store the result rather than the promise. Concurrent
callers on a miss each sign an RSA JWT and each POST for an access token. The
workspace read is exactly that shape: `Promise.all(projects.map(readProject))`,
and each `listOpenPullRequests` asks `tokens.tokenFor(owner, repo)`. On a fresh
isolate with twenty repositories under one installation that is twenty
signatures and twenty mints producing one token. The same happens whenever the
five-minute skew window expires under load.

**Fix.** `importKey` in the same file already memoises the promise
(`this.keyPromise ??=`). Apply the pattern to the other two caches, clearing the
entry on rejection as `GitHubVcsGateway.identify` does.

## 10. Board reads poll cat-factory with no minimum interval

`backend/packages/server/src/modules/reviews/AiReviewService.ts:119-132`.

```ts
const polled = await Promise.all(runs.map(async (run) => this.poll(run)))
```

**What it does.** Every `GET` of a review's AI runs (and `get`, `dismiss`,
`resolve`, `resume`) makes one outbound `getStatus` per in-flight run, then a
store re-read and an update (SELECT plus upsert on D1) per run. `lastPolledAt`
is on the row and the tick already sweeps in-flight runs, but nothing consults
it on the read path. The SPA polls an expanded row every five seconds while a
run is working, and two tabs on the same review double the cat-factory load.

**Fix.** A pure `shouldPoll(run, now, minIntervalMs)` in the service, skipping
runs polled within the last ten to fifteen seconds. The tick keeps its own
cadence. A decision over data, no port change.

## 11. SPA polling and SSE ignore tab visibility, and the data cache is implicit

`frontend/app/app/components/AiReviewPanel.vue:54-73`,
`composables/useAttentionStream.ts:66-118`, and every `useAsyncData` key.

**What is right.** The panel chains `setTimeout` rather than `setInterval`, so
ticks cannot overlap; the cadence drops from five to thirty seconds when a run
is parked on a person; the timer stops with the panel; nothing polls unless a
row is expanded. The stream is one `EventSource`, closed on unmount, and a
reconnect triggers one refetch with a race buffer so events during the fetch
are not lost.

**What costs.**

- No `document.visibilityState` check. A board left in a background tab with
  three running reviews issues three requests every five seconds, and each one
  fans out to cat-factory on the server (finding 10). Browsers throttle hidden
  timers eventually, not immediately.
- The `busy` guard only prevents overlap with a user action. A poll slower
  than five seconds is re-issued on top; Nuxt's default dedupe drops the
  earlier promise but the fetch is not aborted, so requests pile up against a
  slow backend.
- The timer keeps re-arming every thirty seconds after every run has settled.
- The `useAsyncData` cache policy is never chosen. Nuxt 4's default serves a
  remount with the same key from the payload cache, so a return to the board
  shows minutes-old data until Refresh is pressed, adding a project does not
  refresh the workspace's embedded projects, and the cache gains one entry per
  review ever expanded and never evicts.

**Fix.** Stop the timer when nothing is in flight and restart from a
`watch(inFlight)`; skip the tick while hidden and refetch once on
`visibilitychange`; pass an abort signal or track `pending` and skip. Decide the
cache: either `getCachedData: () => undefined` (cheap once the reads are lazy)
or keep it and `refreshNuxtData` after the mutations that invalidate it, with
`clearNuxtData` on panel unmount.

## 12. The same credential is opened twice in one webhook request

`backend/packages/server/src/modules/webhooks/GitHubWebhookService.ts`,
`ReviewService.mirrorToVcs`, `integrations/resolve.ts`.

**What it does.** Each `resolveVcs` is an `integrationTokens.get`, an HKDF
derivation and an AES-GCM open. A `@bot review` comment does `assign` (which
calls `mirrorToVcs`, which resolves) and then `reply` (which resolves again).
`VcsResolutions` exists exactly for this and memoises per provider for one
request, but only `WorkspaceService` and `ViewerService` use it.

**Fix.** Build one `VcsResolutions` per `GitHubWebhookService` and thread it
into `ReviewService` as a constructor option, so the mirror and the reply share
one resolution.

## 13. GitLab reviewer changes: N user lookups per change, none cached

`backend/packages/integrations/src/gitlab/GitLabVcsGateway.ts:447-477`.

**What it does.** `changeReviewers` fetches the MR, then looks up each login by
`GET /users?username=` (in parallel, which is right), then PUTs. Three things
cost more than they need to:

- `removeRequestedReviewers` does N lookups it does not need: the MR it just
  fetched carries `reviewers[].username` and `reviewers[].id`, so removal by
  login is a filter over the payload with zero extra requests.
- Login to id is never memoised. GitLab user ids are stable and the same few
  reviewers recur. The gateway already memoises `identity`, and the factory
  keeps the instance for five minutes, so a `Map<login, number | null>` on the
  instance cuts steady-state lookups to zero.
- The MR read and the lookups are independent but sequential;
  `Promise.all` takes one round trip off the critical path.

A reroll today is roughly `2 + 2N + 2` requests; with the three changes it is
three or four.

## 14. The Worker cron is hourly where the Node interval is a minute

`backend/runtimes/cloudflare/wrangler.toml:17` and
`deploy/backend/wrangler.toml:23` set `crons = ["0 * * * *"]`;
`backend/runtimes/node/src/config.ts:178` defaults `REMINDER_INTERVAL_MS` to
sixty seconds.

**Why it costs.** With `DEFAULT_BATCH = 50` a Worker deployment can send at
most fifty nudges per org per hour, a reminder due at one minute past waits
fifty-nine, and a parked AI review is noticed up to an hour late where Node
notices within a minute. That is a latency ceiling rather than a CPU cost, and
it is the kind of asymmetry the runtime rule exists to catch.

**Fix.** `*/5 * * * *` or every minute, and a line in the docs saying what the
cadence is on each runtime. The scheduled handler's wall-clock limit is far
away today but is the ceiling the serial tick (finding 1) walks toward.

## 15. The Node server runs on defaults: keep-alive, body limit, pool

`backend/runtimes/node/src/index.ts:54` is `serve({ fetch: app.fetch, port })`.
`backend/packages/persistence-postgres/src/database.ts` builds the pool with
only `max`.

- Node's default `keepAliveTimeout` is five seconds, shorter than the idle
  timeout of every common load balancer, which is the classic cause of
  sporadic 502s under keep-alive. `serverOptions: { keepAliveTimeout: 65_000,
headersTimeout: 66_000 }` in the Node facade only; it is a transport concern
  the Worker has no equivalent of, so not a symmetry break.
- Nothing bounds request bodies, so a POST buffers the whole body before
  validation. `bodyLimit` from `hono/body-limit` belongs in `createApp` so both
  facades get it in one commit.
- The pool has no `connectionTimeoutMillis`, so a saturated pool waits
  indefinitely instead of failing fast. Expose it and `idleTimeoutMillis` on
  `PostgresOptions`.

## 16. `review_commitments.find` is not covered by its index

Postgres `attention.ts:400-416`, D1 `attention.ts:107-110`:

```sql
WHERE org_id = ? AND reviewer_id = ? AND pull_request_key = ? ORDER BY created_at, id
```

The only index is `(org_id, reviewer_id, created_at)`, so the planner filters
`pull_request_key` over every commitment that reviewer has ever made, and they
are only ever deleted explicitly. Called on every "I will take it".

**Fix.** Index `(org_id, reviewer_id, pull_request_key, created_at)` in both
dialects: one `index()` in `schema.ts` plus `db:generate`, and a new
`0005_*.sql` for D1. Making `(org_id, reviewer_id, pull_request_key)` UNIQUE is
the stronger option, and it is what the port comment ("a second click is a
no-op") already promises.

## 17. `review_requests` has no ordering index without a status

`WHERE org_id = ? ORDER BY created_at DESC, id DESC` (both stores) is served by
no index: `review_requests_status_idx` is `(org_id, status, created_at)`, and
without a status predicate the engine scans the org's rows and sorts. No index
ends in `id`, so even with one status the tie-break needs a sort step.

**Fix.** `review_requests_created_idx (org_id, created_at DESC, id DESC)` in
both dialects, and extend the status index with `id`. Do it with finding 3,
because a limited, ordered read is exactly what a top-N index scan needs.

## 18. Outstanding counters are adjusted one statement at a time

`ReviewService.ts:226-231` and `:283-285`:

```ts
for (const reviewerId of released) await repositories.reviewers.adjustOutstanding(reviewerId, -1)
for (const reviewerId of change.assign)
  await repositories.reviewers.adjustOutstanding(reviewerId, 1)
```

Each is one atomic `UPDATE`, which is right, but they are sequential on the
webhook and Slack paths and a failure mid-loop leaves counters and the review
disagreeing. N is small (one to three per review).

**Fix.** `Promise.all` is the zero-port-change version. The better one is an
`adjustOutstandingMany(deltas)` port method: one `UPDATE ... FROM (VALUES ...)`
on Postgres, one `batch()` on D1 (already a transaction), a loop in memory, and
a conformance case with mixed deltas and the floor at zero.

## 19. `/health` and the settings screen open every credential per call

`backend/packages/server/src/modules/health/HealthController.ts:30-36`,
`IntegrationSettingsService.ts:119-131`.

Both run four resolutions (two `resolveVcs`, `resolveChat`, `resolveAiReview`),
each an `integrationTokens.get` plus HKDF and AES-GCM when a row exists, and
`/health` also does `integrationTokens.list()`. The health comment acknowledges
the opens. It matters when a load balancer probes the Worker every few seconds.

**Fix.** One `integrationTokens.list()` and open each envelope at most once. For
the liveness flag, `inspect()` (a key-id compare, no decrypt) is enough; only
the settings screen needs the subject.

## 20. Icons are probably fetched at runtime on the static deploy

`frontend/app/nuxt.config.ts` has no `icon` block, and the documented deploy is
`nuxt generate` to a Pages bucket with no Nitro server. Seventeen distinct
`i-lucide-*` icons are used. Without a server endpoint `@nuxt/icon` falls back
to the public Iconify API, so each unique icon is a third-party HTTPS request on
first paint and the icons flash in after the layout. Not confirmed against the
installed module's provider selection; verify with `nuxt generate` and the
network tab.

**Fix.** `icon: { clientBundle: { scan: true, sizeLimitKb: 256 } }` inlines
every icon the templates reference.

## 21. Full PR objects are fetched for six fields

`GitHubVcsGateway.ts:82-99`, `GitLabVcsGateway.ts:398-411`.

`GET /repos/{o}/{r}/pulls?per_page=100` returns the full representation, on the
order of several KB per PR, up to a thousand per project per workspace read;
the mapper uses eight fields. A GraphQL query selecting those fields returns a
fraction of the bytes and the same page count. The doc comment rejects the
search API for consistency reasons that do not apply to GraphQL. Invisible for a
small team; scales with projects × open PRs × refresh frequency.

## 22. Smaller items

- **HMAC key imported per webhook delivery** (`github/webhooks.ts:379-385`,
  `slack/signature.ts:114-120`). Cheap, but pure overhead on every delivery,
  most of which are discarded. Memoise `Promise<CryptoKey>` per secret as
  `GitHubAppAuth.importKey` does. The Slack verifier also builds a hex string
  and compares strings where the GitHub one decodes to bytes and uses
  `timingSafeEqual`; align it.
- **D1 `deleteExpired` is SELECT then DELETE** (`persistence-d1/src/auth.ts:105-116`)
  because the driver discards `meta.changes`. Return `{ changes }` from
  `SqlDriver.run` and it is one statement; only the D1 store changes.
- **`listInFlight` and `listByReview` carry the full findings payload**
  when the tick and the scheduler only need ids, status and `parkedAt`. A
  parked run with forty findings is tens of KB, and fifty per tick is the
  largest per-tick read in the system. A narrow `listInFlightRefs` reading only
  the index columns, in all three stores, is the fix when it shows.
- **Postgres reads select every column** and then map to `data`; D1 already
  selects only `data`. `select({ data })` shaves a little and makes the two
  symmetric.
- **`CatFactoryAiReviewGateway` is rebuilt per resolution** in both runtime
  containers, where the token-based VCS gateways go through the factory's
  five-minute LRU. Costs only allocation today; wrap it in the same map so a
  future cache has somewhere to live, and keep the runtimes symmetric.
- **The gateway LRU evicts by build time, not by use**
  (`integrations/src/factory.ts:99-116`): a hot gateway is evicted before a cold
  one. Delete-and-set on hit fixes it.
- **The SSE stream stringifies each event once per subscriber**
  (`realtime/sse.ts`); serialise once in `publish`. There is also no ceiling on
  subscribers per org; a tight reconnect loop can pile up streams. Cleanup on
  cancel and on enqueue failure is correct, so this is not a leak.
- **In-memory store**: `structuredClone` on every read and write, and O(n)
  scans for `getByPullRequest`, `getByRef` and the digest lookups that walk
  every org's rows per authenticated request. All acknowledged in comments and
  the right trade for a store a restart empties; a `Map<digest, id>` beside
  the row map is the cheap fix if local mode ever seeds thousands of rows.
- **The contracts barrel ships whole to the SPA.** `contracts/src/index.ts`
  re-exports every route, including webhooks, orgs and reminders the SPA never
  calls, and the package declares no `sideEffects: false`, so the bundler keeps
  every top-level `v.object(...)`. Tens of KB; add the flag (the schemas are
  pure) and, if wanted, subpath exports.
- **Configuration refreshes four endpoints after every action**, including
  the API key list after saving a PAT. Split into two `useAsyncData` groups and
  refresh the relevant one.
- **Worker per-request allocations**: `gatewayKey` stringifies fourteen env
  strings including the PEM key per request, and `withOrg` calls `forOrg` a
  second time for a non-default org. Tens of small allocations; a `WeakMap`
  keyed on the `env` object is the fix if it ever shows.
- **CORS origins are computed three times per request** in `app.ts`; set
  once in the first middleware and read it from the context.
- **The Worker logger has no level filter**, so `debug` always serialises.
  One call on a request path today; gate it on a `LOG_LEVEL` var when it grows.
- **Pure packages**: `hasAllSkills` re-normalises the required skills per
  reviewer, `selectReviewers` re-maps the weight vector per draw, and
  `planNextReminder` walks the sent list five times. All bounded by pool size
  and ladder length, microseconds each; clean up when touching the code.
- **`handlesOf` and the author filter in `handOver`** are `find` and `filter`
  over the candidate list; a `Map<id, Reviewer>` built once is the micro-fix.

## What is already right

Worth recording so the next pass does not re-find it.

- **Auth per request is one indexed read.** SHA-256 of the cookie or bearer, a
  unique-index lookup, and `lastSeenAt` and `lastUsedAt` writes throttled to
  five minutes and a day. No slow KDF on the hot path.
- **`withOrg` is an object spread.** `forOrg` builds eleven statement holders
  with no I/O on the durable stores and is a `Map.get` in memory.
- **Keys are memoised where it matters.** The cipher caches its HKDF base key
  and key id, the state signer its HMAC key, the GitHub App its PKCS#8 import
  and its installation tokens until five minutes before expiry, and the Worker
  caches the cipher and the gateway factory per isolate. The Hono app is built
  once per isolate.
- **Per-request resolution caches exist where the fan-out is widest.**
  `VcsResolutions` across viewer and workspace, `AiReviewService.resolution`
  per instance, one `resolveChat` per org batch on the tick.
- **The workspace sweep is parallel** across projects, resolves one gateway per
  host rather than per project, and partitions in pure code.
- **Every durable read is indexed on a composite that starts with `org_id`**,
  and the two dialects declare the same set. `ai_review_runs_status_idx` is
  declared `NULLS FIRST` on Postgres to match the query, so the rotation read
  is an index scan. `listDue` and `listInFlight` push status, ordering and
  `LIMIT` into SQL, and the least-recently-polled ordering prevents head-of-line
  starvation.
- **Counters and claims are single atomic statements**: `adjustOutstanding` is
  an `UPDATE ... GREATEST(..., 0)` excluded from the upsert branch;
  `identities.link` and `orgs.create` are one `INSERT ... ON CONFLICT ...
RETURNING`; `cancelScheduledForReview` is one multi-row upsert on Postgres
  and one `batch()` on D1.
- **The tick cannot overlap on Node** (`oneAtATime`) and is detached with
  `waitUntil` on the Worker; passengers are isolated from nudges.
- **Pagination is bounded** in both VCS gateways (ten pages of a hundred,
  stopping on a short page without a probe), GitHub reviewer changes are single
  batched calls, and GitLab skips the PUT when the set is unchanged.
- **Webhook bodies are read raw once**, verified, then parsed; event parsing
  is a pure function over the parsed payload.
- **Valibot schemas are module-level constants** compiled once at mount, and
  the regexes on the request path are module constants.
- **The SPA polls only what is moving**: an expanded AI-review row is re-read
  every five seconds while a machine is working, every thirty while parked, and
  the timer stops with the panel. `EventSource` reconnects on its own and the
  page refetches the inbox on reattach.
- **The SPA is otherwise disciplined**: one shared API client per base URL,
  one shared auth state, no `setInterval`, no deep watchers, no index keys,
  modal bodies behind `v-if`, and no heavy dependencies beyond the UI kit.
- **Pure packages are clean**: exclusion sets and normalised skills are built
  once per selection, timestamps are numbers throughout, and every decision
  takes its clock, random source and ids as ports.
- **Runtime facades build the expensive things once**: the Node container and
  app at boot, migrations before listen, the pool closed on every failure path;
  the Worker's app at module level and its cipher and gateway factory per
  isolate.
