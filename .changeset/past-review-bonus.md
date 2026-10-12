---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Reviewers who finished reviews on pull requests opened in a pull request's repository over the last six months are preferred, both in the recommendations and in the automatic assignment. The bonus is bounded and diminishing (`PAST_REVIEW_PREFERENCE`, `PAST_REVIEW_HALF_POINT`), so holding the whole wanted mix still counts for more than any history. `matchPreference` is the one term both paths read: the draw multiplies it by the load-damped weight, and the recommendations rank on it before open reviews. A recommendation's `reasons` gain `pastReviews`, and the Ask for attention dialog shows it.

`ReviewRequestRepository.listForRepository` reads one repository's reviews in the named statuses since a moment, newest first and capped, in all three stores. D1 needs migration `0010_review_history.sql` and Postgres its matching migration, both adding `review_requests_repo_idx`. `selectReviewers`, `rankCandidates`, `scoreCandidates` and `scoreCandidate` take the past-review counts as a required `pastReviews` on their `ScoringTarget`, and a `ScoredCandidate` carries `pastReviews` and `preference`.
