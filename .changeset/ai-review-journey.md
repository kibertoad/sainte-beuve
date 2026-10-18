---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/integrations': patch
'@sainte-beuve/app': minor
---

An AI review is followed and settled on its own screen, `/ai-review?review=<id>`,
instead of in cat-factory's app.

The screen shows where the run stands (filed, reviewing with its slice count,
waiting on you, posting or fixing, done), what cat-factory is doing right now,
the reviewer's own summary, and the findings grouped under the slice of the diff
each came from. The curator settles the review one way, comments for the author
or fixes by cat-factory, on the findings they pick, and one Apply sends it.
Challenge stays per finding, and the post receipt and the fixer's account land
on the same screen. The draft is kept in the browser until it is applied. The
**AI review** buttons, the board row and the parked-review Slack nudge all lead
there.

The curation carries the reviewer's `summary`, its `slices` and each finding's
`sliceId`; a run carries the `progress` of the step it is on.

The slice count while a review is still running is read off the reviewer's own
to-do list. It used to read the recorded slicing, which cat-factory fills in only
when the review parks, so the count never showed mid-review and **Resume** was
never offered.
