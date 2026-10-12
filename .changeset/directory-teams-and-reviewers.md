---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

With cat-factory configured, an org's teams follow its cat-factory workspaces and its reviewer pool
follows the account's members, matched on their GitHub or GitLab account. A followed reviewer's
name, handles and team are set in cat-factory and answer 409 here; a followed team cannot be
renamed or deleted here. Somebody the directory stops listing is paused and signed out. The mirror
is a new source-neutral `external_directory` table (D1 `0013_external_directory.sql`, Postgres
`20261012115750_external_directory`).
