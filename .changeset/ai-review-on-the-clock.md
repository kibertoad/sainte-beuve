---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/ai-review': minor
---

The AI review on the clock: a delegated review is polled by the reminder tick, not
only by whoever opens the row.

cat-factory drives a review asynchronously and calls nothing back, so until now
the only thing that ever asked it where a review got to was a read of the board.
A review that parked with its findings therefore waited on a person who had no
way of knowing it was waiting on them, for as long as nobody happened to look.
The tick asks on everybody's behalf, per org, capped the way the nudges are.

- **On the clock AND on the read, not one or the other.** A read still polls the
  runs it is about, because that is what keeps an OPEN row live; the tick polls
  what a tenancy has in flight, which is what makes a CLOSED one true. Dropping
  the read would make the board lag by up to a tick at the moment somebody is
  watching it, and the two together cost one extra call per unsettled run per
  tick.
- **It rides the reminder clock rather than getting one of its own.** That pass
  is the one periodic thing both runtimes already have — a cron trigger on the
  Worker, an interval on Node — and a poll wired on one facade and not the other
  is exactly the asymmetry this layout exists to prevent. The expired-session
  sweep is already there for the same reason, and neither passenger can fail a
  pass whose nudges have already gone out.
- **A status COLUMN on `ai_review_runs`, with a migration per dialect.** The
  clock's read is "what is unsettled in this org", which has no review id to
  narrow it and is therefore the one read of that table that would scan it.
  Neither engine indexes a JSON extraction usefully, so the status joins
  `review_requests.status` and `reminders.status` as a column beside the payload,
  under `(org_id, status, last_polled_at)`. SQLite adds it in place with a default
  it never afterwards relies on; Postgres adds it nullable, backfills from the
  payload and tightens it.
- **A `last_polled_at` cursor beside it, and the read is a ROTATION.** This is
  what makes the batch cap a rate limit rather than a queue with a permanent
  head. `awaiting_selection` is a state no poll can end — only a person curating
  can — so ordered by `requested_at`, a tenancy holding a batch's worth of parked
  reviews would fill every batch for ever and the clock would never reach a newer
  review at all, which is the silence it exists to end. Least recently polled
  first, a run polled on this tick goes to the back and everything in flight comes
  round. A null sorts FIRST, which both durable stores spell out because Postgres
  would otherwise sort it last, and the index carries `NULLS FIRST` so the order
  the read asks for is the order the index is in.
- **`AI_REVIEW_IN_FLIGHT_STATUSES` is on the contract**, because three stores and
  the poll now agree on what "in flight" means: a `WHERE ... IN` in two SQL
  dialects, a filter in the third, and the service's own guard. Spelled out per
  store it would drift, and drift silently — a store that forgot
  `awaiting_selection` would simply stop handing parked reviews to the clock.
- **The sweep is sequential, and it writes off what it can never poll.** A read
  polls one review's runs while this polls a whole tenancy's, and a tick that
  opened thirty connections to one cat-factory at once would be rate-limited into
  exactly the silence it exists to end. A run left in `requested` with no task id
  — which is what a process dying between the row and the call leaves behind — can
  never be settled from cat-factory's side, so after a grace period the sweep
  settles it rather than leaving it in flight, and on the board, for ever.
- **Every org's nudges go out before any org's passengers run.** The tick walks
  the tenancies twice rather than once. Interleaved, the first org's AI-review
  poll — a batch of calls to an instance that org configured and nobody else can
  vouch for — sits in front of every later org's reminders, so one slow instance
  would spend the invocation and the tenancies behind it would send nothing, every
  tick, for as long as it stayed slow.
- **A poll writes onto the row as it stands NOW, refusal included.** The clock
  made overlapping polls ordinary: the sweep walks a batch it snapshotted while
  reads and curation verbs write the same rows. So a refusal is not stamped on a
  run that settled underneath it — a settled run is never polled again, and the
  board would say for ever that a finished review could not be read — and a
  curation from before the last post no longer overwrites the receipt for comments
  that really did reach the pull request.
- **A deployment with nothing in flight resolves no credential.** The store is
  asked first: a tenancy with an empty in-flight read is the common case on the
  clock, and that read is one indexed, capped lookup where resolving is a
  credential read plus an HKDF derivation plus an AES-GCM open.
- **Every call to cat-factory carries a deadline**, and the Node clock runs one
  pass at a time. An instance that accepts a connection and never answers would
  otherwise hold a whole pass open; an interval that fires over a pass still
  running would send a nudge the last pass is about to mark sent.
- A parked review still tells nobody — the clock finds it, and no nudge says so.
  That is a reminder kind rather than a poll, and it is the half of
  `docs/implementation-plan.md` slice 4 that is left.
