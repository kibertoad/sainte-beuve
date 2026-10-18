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
waiting on you, posting and fixing, done), what cat-factory is doing right now,
the reviewer's own summary, and the findings grouped under the slice of the diff
each came from. Every finding gets a choice: comment on the pull request, have
cat-factory fix it, or ignore it. One Apply posts the comments and then hands the
fixes to the fixer. Challenge stays per finding, and the post receipt and the
fixer's account land on the same screen. The choices are kept as a draft in the
browser until they are applied. The **AI review** buttons, the board row and the
parked-review Slack nudge all lead there.

`POST /ai-review/runs/:runId/resolve` takes `fixFindingIds` with `action: post`,
which needs a cat-factory that serves `fixFindingIds` on the pr-review decision
(kibertoad/cat-factory#2440). The curation reports that as `combinesPostAndFix`,
and a split sent to an older instance is refused with a 409 rather than posted
without its fixes. A finding named in both `findingIds` and `fixFindingIds` is
refused with a 400. The curation also carries the reviewer's `summary`, its
`slices`, each finding's `sliceId` and the queued `fixFindingIds`; a run carries
the `progress` of the step it is on.

The slice count while a review is still running is read off the reviewer's own
to-do list. It used to read the recorded slicing, which cat-factory fills in only
when the review parks, so the count never showed mid-review and **Resume** was
never offered.
