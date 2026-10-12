---
'@sainte-beuve/contracts': minor
'@sainte-beuve/server': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/app': minor
---

An AI review can be started from any pull request row, not only from the board.

`POST /api/v1/ai-review` takes a pull request instead of a review id. It tracks
the pull request on the board when it is not there yet, then files the review on
that row, under the same limit as every other way to ask. An org without
cat-factory gets a 503 and no board row. A row that does not know the author
(a commitment) sends none, and the author is read from the host instead, so the
router still keeps the review away from them. A refusal about the review (a run
already in flight, the hourly limit) names it in `details.reviewId`.

The workspace's committed list carries each commitment's `projectId`, as My
Reviews does, from the new `placeCommitments` in `@sainte-beuve/reviewers`.

The workspace, My PRs and My Reviews show an **AI review** button on every row
in a linked repository, once the org has cat-factory. It takes the viewer to the
board row, where the findings are curated, and to the row a refusal names.
