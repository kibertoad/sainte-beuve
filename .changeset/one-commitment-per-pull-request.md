---
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': patch
---

One commitment per reviewer and pull request, enforced by the store. `ReviewCommitmentRepository.create` is replaced by `createOrGet(commitment)`, which inserts the row or answers the one the reviewer already holds on that pull request, with `created` true only for the call that wrote it. Two commits landing together (a double click, an inbox click and a Slack button) now leave one row, and only the winning call requests the reviewer on the host.

Postgres and D1 carry a unique index `review_commitments_pr_idx` on `(org_id, reviewer_id, pull_request_key)` (D1 `0015_unique_commitments.sql`, Postgres `20261012153000_unique_commitments`). The migration first lowercases each key as `pullRequestKey` writes it, then folds existing duplicates: the earliest row is kept, takes over a host request a later duplicate held, and the later rows are deleted. `@sainte-beuve/kernel` exports the insert-or-read loop as `insertOrRead`.
