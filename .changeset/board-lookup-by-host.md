---
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': patch
---

A board lookup by pull request tells GitHub and GitLab apart.

`ReviewRequestRepository.getByPullRequest` takes a `PullRequestAddress`
(provider, owner, repo, number) and matches on `pullRequestKey`, and
`listForRepository` takes a `ProjectRef` and matches on `projectRefKey`. Before,
a GitHub pull request and a GitLab merge request with the same names resolved to
each other's board row, and a path that differed only in case was a second pull
request. D1 and Postgres replace the `pr_owner`, `pr_repo` and `pr_number`
columns of `review_requests` with `pull_request_key` and `repo_key`, backfilled
from each row, and both lookup indexes are rebuilt on them.
