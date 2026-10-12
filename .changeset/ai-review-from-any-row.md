---
'@sainte-beuve/contracts': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

An AI review can be started from any pull request row, not only from the board.

`POST /api/v1/ai-review` takes a pull request instead of a review id. It tracks
the pull request on the board when it is not there yet, then files the review on
that row, under the same limit as every other way to ask. An org without
cat-factory gets a 503 and no board row.

The workspace, My PRs and My Reviews show an **AI review** button on every row
in a linked repository, once the org has cat-factory. It takes the viewer to the
board row, where the findings are curated.
