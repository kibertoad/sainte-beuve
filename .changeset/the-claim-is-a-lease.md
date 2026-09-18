---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/app': patch
---

Two ways the last round of performance work could leave a thing stuck.

- **A reminder claim is a LEASE, not a permanent take.** Claiming a due nudge
  before posting it is what stops two ticks nudging the same person twice, but a
  process that died between the claim and the mark left the row in `sending` for
  good — and that is not one lost nudge. The policy hands out one reminder at a
  time and re-plans only once a delivery settles, so the stranded row was the
  review's entire outstanding schedule: `listDue` reads `scheduled` and never saw
  it again, `cancelScheduledForReview` filters on `scheduled` and never cleared
  it, and an open review nobody touched was quietly never chased again, with
  nothing on the board saying why. `claim` now stamps `claimedAt`, the tick reads
  the claims older than five minutes before it reads what is due, and gives up on
  them: `failed` with a reason where an archived channel's failure would show,
  then the ladder re-planned — whose rung, already past its time, goes out in the
  same pass. Recorded on `TickResult.recovered`, because senders that keep dying
  is a different fault from nudges that keep failing to send. A claim with no
  timestamp — a row written before the column — is never swept: it cannot be
  aged, and guessing would take a live send away from the sender still making it.
  Giving up is itself one conditional statement, as the claim is: a re-plan is a
  cancel and a create, and two passes repairing one row would leave the review
  with two scheduled nudges — the duplicate the claim exists to prevent, put back
  by the thing that repairs it. New `claimed_at` column and index in both
  dialects, `listStalledClaims` and `abandonClaim` in all three stores, and
  conformance cases for the lease, the cap, the null and the second pass.
- **Signing out re-reads who is calling.** Configuration reads `GET /auth` only
  when nothing has read it yet, which is what stops a second auth hop landing in
  front of the screen — but sign-out re-runs that same handler, and the held
  answer still said the person was signed in. The Access card kept their name,
  the shell rail kept the signed-in links, and `isAdmin` stayed true long enough
  to fire three admin-only settings calls the API had just started refusing.
  `useAuthState` gains `invalidate()`, which sign-out calls before the refresh it
  triggers: held state is a cache, and the one event that invalidates it now says
  so. A read already in flight when it happens can no longer write its answer
  back over the newer one.
