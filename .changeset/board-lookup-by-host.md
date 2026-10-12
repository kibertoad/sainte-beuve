---
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': patch
---

A board lookup by pull request tells GitHub and GitLab apart.

`ReviewRequestRepository.getByPullRequest` takes a `PullRequestKey` (provider,
owner, repo, number) and every store filters on the provider. Before, a GitHub
pull request and a GitLab merge request with the same names resolved to each
other's board row. D1 and Postgres gain a `pr_provider` column on
`review_requests`, backfilled from each row's payload, and the lookup index
includes it.
