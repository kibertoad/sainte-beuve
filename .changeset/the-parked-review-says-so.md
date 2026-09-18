---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reminders': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': minor
---

The parked review says so: a reminder kind for a delegated AI review waiting on
somebody to curate its findings.

The clock already asked cat-factory where every delegated review got to, so a
review that parks on its findings is a fact the deployment holds. It held it and
told nobody: the row said `awaiting_selection` to whoever opened it, which is
exactly the person who would have opened it anyway, so the loop still ended at
somebody's habit of checking. This is the half of `docs/implementation-plan.md`
slice 4 that was left.

- **A reminder kind, not a notification of its own.** Everything else that
  interrupts somebody about a review is a row in `reminders`: scheduled ahead of
  time, snoozable from Slack with `/review snooze`, recording why a delivery
  failed, capped per tick. A parked review announced down a second path would be
  the one nudge none of that was true of, and the first one nobody could snooze.
- **Planned by the ladder, so it COMPETES.** `planNextReminder` still answers
  with at most one reminder, decided by the clock rather than by a precedence
  between kinds, and the outstanding schedule for a review is still a single row.
  A parked review that is also past its deadline gets the escalation first and
  the park behind it, because the wide nudge is the one that widens the audience
  and the tick re-plans after every send.
- **Once per park, and a re-park is a new park.** The other rungs chase a
  SILENCE, so repeating them means chasing harder; this one reports an EVENT, and
  a second nudge about the same park says nothing the first did not. What makes
  that a timestamp comparison rather than a budget is the post that fails: it
  re-parks the review with a receipt saying what did not land, which is a thing
  to say again.
- **`parkedAt` is stamped on the EDGE, and it lives on the payload.** On the edge
  because the ladder counts from it: moved by every poll that found the run
  parked, it would push the nudge out by a tick for ever and never send it. On
  the payload — unlike `status` and `lastPolledAt` — because nothing selects on
  it: the clock reads what is in flight by status and the ladder asks for one
  review's runs by `review_id`, both already indexed, so a column would be a
  migration in two dialects bought for a field no `WHERE` clause names. Which is
  why it carries a DEFAULT and not only a `v.nullable`: the payload is parsed
  through its contract on every read, and a field the older shape has no key for
  is a `StoredRowError` on every run delegated before this release — on a path the
  ladder now takes on every status write and every send, so one such row would 500
  the review it is on and silence the clock that would have healed it. Two cases in
  `persistence-conformance`, against both durable stores.
- **A re-park is found by `postAttempts`, not by the status.** `resolve` answers
  202 and cat-factory acts asynchronously, so a post that starts and fails between
  two polls returns the run to `awaiting_selection` having never shown up on the row
  as anything else — the exact case the timestamp comparison exists for, and the one
  a status comparison cannot see. `postAttempts` only ever goes up, which is already
  how `curationFor` decides which of two pictures of a run is the newer one.
- **A snooze defers the LADDER, on `snoozedUntil`.** The outstanding schedule is
  rewritten from scratch every time anything moves the ladder, and one of those
  things is now a background poll: a pause that lived only in the `dueAt` of the row
  somebody asked for it on would be undone by a pass they never see, and the
  replacement would come due at a time that has already gone by. `planNextReminder`
  reads the pause off the outstanding row, carries it onto what it writes next, and
  drops it once the rung it defers would come due after it anyway.
- **The poll re-plans, in both directions.** A poll is the only thing that ever
  learns a review parked, and reminder rows are written ahead of time, so without
  this the nudge would be scheduled whenever something ELSE re-planned the
  review — which, for a review nobody is touching, is never. The other direction
  matters as much: a park that ENDS takes the nudge off the schedule, so a review
  curated ten minutes after it parked is not announced afterwards. Both halves
  run on the read path as well as the clock's, so whichever poll gets there first
  is the one that schedules.
- **ONCE per pass, and outside the poll's own try/catch.** `scheduleNextReminder`
  is a cancel-then-create over a schedule meant to be a single row, so a read that
  re-planned per run would write two scheduled rows for two runs that parked
  together — a nudge sent twice, and two rows where a snooze assumes one. And the
  catch around a poll is for a cat-factory that cannot be reached: a reminder store
  that refused a write, caught there, would be recorded on the run as "the AI review
  could not be read from cat-factory" and the park would never be announced, because
  the stamp is already down and there is no edge left for a later poll to find. So
  the re-plan sits outside it, and a failure puts the stamp back and lets the next
  poll try again.
- **Not gated on the pending budget, and it does not spend it.** A review whose
  reviewer has gone quiet is exactly the one somebody delegated to cat-factory,
  and going silent about the findings because the human ladder is spent would
  mute the half that still has something new to report.
- **The same audience as the review's own nudge**: the assigned reviewer's DM, or
  the channel while nobody owns it. The escalation is the only rung allowed to
  widen an audience, and a parked review that went to the channel for an assigned
  review would widen it as a side effect of pressing a button.
- **A resolved review is silent, parked findings and all.** The findings are
  still there and the board still says so, but a pull request that has been
  approved or closed is not something to interrupt anybody about.
- `aiReviewParkedAfterMs` defaults to fifteen minutes, which is the one rung
  measured in minutes: the others wait on somebody's attention, and this one waits
  on nobody at all.
