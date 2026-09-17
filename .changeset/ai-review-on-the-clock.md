---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
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
  under `(org_id, status, requested_at)`. SQLite adds it in place with a default
  it never afterwards relies on; Postgres adds it nullable, backfills from the
  payload and tightens it.
- **`AI_REVIEW_IN_FLIGHT_STATUSES` is on the contract**, because three stores and
  the poll now agree on what "in flight" means: a `WHERE ... IN` in two SQL
  dialects, a filter in the third, and the service's own guard. Spelled out per
  store it would drift, and drift silently — a store that forgot
  `awaiting_selection` would simply stop handing parked reviews to the clock.
- **`listInFlight` answers oldest first, and the sweep is sequential.** The cap is
  a cap: the run that has been waiting longest is the one somebody is most likely
  to be waiting on, and what a cap leaves over is picked up next tick rather than
  starved. Sequential because a read polls one review's runs while this polls a
  whole tenancy's, and a tick that opened thirty connections to one cat-factory at
  once would be rate-limited into exactly the silence it exists to end.
- **A deployment with no cat-factory asks the store nothing**, and a poll that is
  refused is recorded on the run rather than in a log: the board already shows
  that reason, and a revoked key refuses every poll the same way for ever.
- A parked review still tells nobody — the clock finds it, and no nudge says so.
  That is a reminder kind rather than a poll, and it is the half of
  `docs/implementation-plan.md` slice 4 that is left.
