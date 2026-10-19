---
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/server': patch
---

Asking reviewers from My PRs twice at the same moment no longer opens two asks for one pull request.
The second submit adds its people to the ask the first one opened, and nobody is named twice.

`AttentionRepository` gains `createOrGetOwn`, which writes an ask or answers the requester's open one
on that pull request. Both durable stores enforce it with a partial unique index on the new
`own_ask_key` column over open asks: D1 migration `0020_own_attention_asks`, Postgres migration
`20261019110347_own_attention_asks`. Asks raised anywhere else carry no key and behave as before.
