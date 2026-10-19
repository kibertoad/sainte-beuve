---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

A pull request row with an AI review in flight no longer offers **AI review**, which admission
would refuse. It offers one **AI review progress** button per run in flight instead, each opening
the review screen on its run. The rows learn it from the new `POST /ai-review/latest/lookup`,
read from the store with the same in-flight rule admission uses (`isAiReviewInFlight`, now exported
by `@sainte-beuve/reviewers`).

An assessment in progress is shared by every row showing its pull request, so they all wait on it
(**Assessing**) rather than offering a second. An assessment is one synchronous cat-factory call
with nothing stored until it answers, so it has no progress view to link to.
