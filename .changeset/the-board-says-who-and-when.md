---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': patch
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Close the five high findings of the UX review: the board says who and when, the
reminders land somewhere, and nothing is destroyed on one click.

Each of these is a place a person was sent somewhere wrong, told something
false, or lost work without being asked.

- **A reminder linked to a page that does not exist.** `reminderMessage` built
  `${appBaseUrl}/reviews/<id>` by hand, and the SPA has never had that route, so
  every nudge landed on the default error page — including the parked-AI-review
  one, whose whole point is that the findings are on the board and not on the
  pull request. The path is now `boardReviewPath` in `@sainte-beuve/contracts`,
  the message builds it and the board reads the `?review=` it names: the row is
  expanded, scrolled to, and said to be missing if the board no longer carries
  it. The two tests that asserted the broken URL restated it by hand; they ask
  the helper now.

- **The board showed everything, under a subtitle that said it did not.** The
  route already defaulted to the active statuses; the screen now agrees with it,
  with a "Show settled" switch that re-reads rather than cutting a list the cap
  was applied to before the filter. What a settled row is, and where it sorts,
  is one definition.

- **A row did not say who was on the hook.** `GET /reviews` answers board rows —
  the aggregate plus `assignedReviewers`, joined from the directory on the way
  out — and the row renders the names, how long the review has waited, a due
  marker and a high-priority mark. The order is urgency rather than insertion:
  overdue, then priority, then whatever has waited longest, settled rows last.
  Both the join and the order are `buildBoard` in `@sainte-beuve/reviewers`,
  pure and over an injected clock, so the board is a decision with a suite
  instead of whatever the store answered in. The status badge reads a label from
  the contracts (`reviewStatusLabel`) rather than `in_review`.

- **Five destructive actions were one unconfirmed click with no undo.**
  `useConfirm` is a promise and one `ConfirmDialog` in the shell, and Remove a
  project, Revoke a key, Clear a credential and Finish without posting all ask
  first, each naming what is lost. Dismissing the dialog is a no. `Clear` and
  `Finish without posting` are `color="error"` like the other two, and Remove has
  a busy key of its own so it no longer spins Save beside it.

- **The attention inbox hid its own failure, and Refresh did not refresh it.**
  A failed read left the list empty, which is indistinguishable from nobody
  waiting, so the card reported "Nobody is waiting on a reviewer" over a 503. It
  takes the error and renders it, and the page's Refresh awaits the inbox's read
  as well as its own — the badge that says "refresh to update" now points at a
  button that does.

Two smaller things came with them: the board heading is "Board", which is what
the rail, the README and the Slack copy call it, and the AI-review panel checks
`pending` before its empty state, so opening a row no longer says nothing has
been delegated while the read is still in the air.

`GET /api/v1/reviews` answers a wider row and a different order. The fields that
were there are unchanged, so a caller reading the aggregate is unaffected; one
that depended on newest-first is not.
