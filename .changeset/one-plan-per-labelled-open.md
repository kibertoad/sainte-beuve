---
'@sainte-beuve/server': patch
---

A pull request opened with the review label already on it plans its reminder
once, not twice. `create` planned the ladder and the assignment that followed
re-planned it, so the most common webhook wrote a reminder row only to cancel it
a few milliseconds later. `ReviewService.trackAndAssign` skips the first plan for
a new review, and plans itself when nobody could take it, so a review with a
shortfall still has a ladder.
A failure after the insert plans the ladder before it rethrows, so skipping the
first plan cannot leave a review with none.
