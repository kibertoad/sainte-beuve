---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Every pull request row in the workspace, My PRs, My Reviews and PRs to review has an **Assess**
button. A pull request not assessed before is scored by cat-factory's assessor, and its risk,
impact and complexity are stored per pull request (`pull_request_assessments`, new in all three
stores) and shown on the row in every list. It only scores: nothing is approved and no board row is
opened. The risk policy's cat-factory assessments record their scores in the same store. New routes:
`POST /pull-request-assessments` and `POST /pull-request-assessments/lookup`. Needs the
`0019_pull_request_assessments` D1 migration and the matching Postgres migration.
