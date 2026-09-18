---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/ai-review': patch
'@sainte-beuve/worker': patch
---

The four things `docs/performance-review.md` said would scale badly first: the
tick's fan-out, the nudge nothing claimed, the board read with no ceiling, and an
outbound call with no deadline.

- **The tick is bounded-concurrent instead of serial.** It walked every org one
  at a time and every due nudge inside them one at a time: an idle tenancy cost
  three store round trips before the next one was looked at, and a due nudge
  about seven plus an outbound post, none of them overlapping. On D1, where a
  statement is a network hop, one tenancy's batch could outlast the interval that
  started it — and a Node tick that overruns its interval is skipped, which
  delays the reminders that caused it. Both walks now run a handful of passes at
  a time, with the ordering that matters kept exactly as it was: every org's
  nudges still go out before any org's passengers run. Inside one org the batch
  is split into lanes by REVIEW, because sending re-plans that review's ladder
  and two deliveries for one review must not interleave a cancel with a create.
- **A nudge is CLAIMED before it is sent.** `listDue` is a read, so two passes
  over the same batch both saw the same fifty rows and both posted — and two
  passes is what a second Node replica is, or a Worker cron firing while the last
  invocation is still inside `waitUntil`. `ReminderRepository.claim` moves the
  row out of `scheduled` in ONE conditional statement on both durable stores (a
  check-and-set in memory), returning whether this caller got it, and delivery
  skips what it could not claim. `sending` joins the reminder statuses on the
  contract to name that window. It is a correctness fix as much as a performance
  one, and it does not claim exactly-once: a process that dies mid-send leaves a
  row in `sending` and that nudge is not re-sent, which is the right way round
  for a reminder.
- **`GET /reviews` stops growing with the table.** Terminal reviews are never
  archived, so the board route answered with every review the org had ever
  tracked and valibot-parsed a payload per row nobody looks at — slower every
  week, and billed as CPU on the Worker. It now answers the ACTIVE statuses,
  newest first, capped at 200, and takes `?status=` and `?limit=` for anything
  else; `ReviewRequestRepository.list` grew a `limit` in all three stores with a
  conformance case, and the route refuses a status no review can be in rather
  than answering an empty board. `ACTIVE_REVIEW_STATUSES` is on the contract,
  because the route's default, the SPA and `/review list` in Slack now agree on
  what a board is about.
- **Two indexes for that read, one per dialect.** The ordering is
  `created_at DESC, id DESC`, and nothing served it: the only composite started
  with the status, so an unfiltered read scanned the org's rows and sorted them,
  and a filtered one still needed a sort for the tie-break. The status index is
  rebuilt with the ordering spelled out and the tie-break added, and
  `review_requests_created_idx` covers the unfiltered board, so a capped read is
  a top-N scan.
- **Every call to a host we do not control carries a deadline.** `withDeadline`
  moves out of the cat-factory adapter into the kernel and now wraps GitHub,
  GitLab and both Slack posters as well, combining with any signal the caller
  supplied. Without one, a connection that is accepted and never answered held
  whatever was waiting behind it: the tick awaits a post per nudge inside one
  invocation, and a workspace read fans out per project with `Promise.all`, so
  one hung host held a person's whole screen.
- **The Worker cron matches the Node interval's intent.** Hourly stopped being
  defensible when the same tick started polling the AI reviews in flight: a
  delegated review that parked on its findings waited up to an hour to be said
  out loud where Node noticed within a minute, which is the runtime asymmetry
  this layout exists to prevent. `*/5 * * * *` on both wrangler configs.
