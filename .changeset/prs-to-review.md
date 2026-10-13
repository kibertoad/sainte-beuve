---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

PRs to review: the open pull requests in the linked repositories you are best
placed to review next, best first.

`GET /api/v1/to-review` lists the ones you committed to and have not reviewed
yet first. The rest are ranked on how long they have gone without any review
(more so when nobody committed to them), then on the share of the repository's
skills and domains you hold, your recent reviews and pull requests in the
repository, and whether the host is waiting on you. Each row carries the
reasons it ranks where it does.

Breaking changes to the published packages:

- `VcsGateway.pastReviewers(project, since)` is now
  `pastActivity(project, since)`, answering `{ reviewers, authors }` from the
  same host read.
- `VcsGateway` gains `openPullRequestReviews(project)`: who has reviewed each
  open pull request, and who the host is still waiting on for a review.
- `ReviewCommitmentRepository` gains `listByPullRequests(pullRequests)`, backed
  by a new `review_commitments_key_idx` index in both durable stores.
