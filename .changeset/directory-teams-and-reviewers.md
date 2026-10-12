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
name and handles are set in cat-factory and answer 409 here, and their team is one of their
workspaces' (`GET /reviewers/{id}/team-choices` lists them); a followed team cannot be renamed or
deleted here. Somebody the directory adds joins paused with no skills, and somebody it stops
listing is paused and signed out. A key limited to some workspaces is reported on the connection
(`repositorySync.reach`), since cat-factory lists it no users. Clearing cat-factory lets go of
the teams and reviewers it followed. The mirror
is a new source-neutral `external_directory` table (D1 `0014_external_directory.sql`, Postgres
`20261012115849_external_directory`).
