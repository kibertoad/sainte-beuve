---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

A pull request row whose AI review has completed offers **AI review results** (green, a
file-check icon), opening the review screen on that run. Ordering a fresh review stays available
as a secondary icon button beside it. A row with no review offers **Order AI review**, and a run
in flight keeps its **AI review progress** button.

The rows learn it from `POST /ai-review/latest/lookup` (`lookUpLatestAiReviewRunsContract`), which
answers each pull request's runs in flight and its latest completed run. It replaces the in-flight
lookup and reads through two new batch reads on every store, `reviews.listByPullRequests` and
`aiReviewRuns.listByReviews`, so a list screen costs a few statements whatever its length.
