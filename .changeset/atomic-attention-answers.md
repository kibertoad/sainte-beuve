---
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': patch
---

Answers to an attention request are written atomically. `AttentionRepository.update` is replaced by `change(attentionId, change)`, which hands `change` the request as stored and, when another write landed between its read and its write, reads again and calls it again. Two commitments landing at the same moment now both count; before, the second write dropped the first.

Postgres and D1 carry a `revision` column on `attention_requests` (a migration in each dialect), and every write moves it on. `@sainte-beuve/kernel` exports the compare-and-set loop as `writeAtRevision`, and `@sainte-beuve/reviewers` exports the commit and cancel decisions as `decideCommit` and `decideCancel`.
