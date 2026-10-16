---
'@sainte-beuve/kernel': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
---

The screens keep what they read from GitHub and GitLab in a new `host_snapshots` table and serve it
for a short while instead of asking again: a repository's open pull requests, who reviewed them,
its recent activity, a pull request's status, and a person's host searches. When a fresh read
fails, the older snapshot is served. Repositories are read four at a time instead of all at once.
Together these stop My Reviews, My PRs and PRs to review from tripping GitHub's secondary rate
limit. Needs the `0018_host_snapshots` D1 migration and the `host_snapshots` Postgres migration.
