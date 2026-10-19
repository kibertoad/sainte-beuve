---
'@sainte-beuve/app': patch
---

The My PRs page hands conflict resolution and the "Suggest reviewers" dialog to their own composables,
`useConflictResolution` and `useSuggestReviewers`, which keeps the page inside the file size budget.
Nothing on the screen changes.
