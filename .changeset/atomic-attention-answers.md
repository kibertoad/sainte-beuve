---
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': patch
---

Answers to an attention request are written atomically. `AttentionRepository.update` is replaced by `change(attentionId, change)`, which hands `change` the request as stored and, when another write landed between its read and its write, reads again and calls it again. Two answers naming the same field at the same moment now both count: two commitments, two declines, two people asked, or two batches of recorded DMs. Every attention write in the server (commit, decline, ask more, cancel, recording DMs) goes through it.

Postgres and D1 carry a `revision` column on `attention_requests` (D1 `0011_attention_revision.sql`, Postgres `20261012114012_lush_mandroid`, both `NOT NULL DEFAULT 0` so existing rows take it), and every write moves it on. `@sainte-beuve/kernel` exports the compare-and-set loop as `writeAtRevision`. `@sainte-beuve/reviewers` adds `cancelChange`, and `commitmentChange` answers null for a commitment already on the ask.
