---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

An Organization screen, a managed team list, and a default repository owner.

- Teams are a list per org (`GET/POST /api/v1/teams`, `PATCH/DELETE /api/v1/teams/:teamId`). Any member may create a team they own; the owner or an admin may rename it, delete it or hand it to somebody else, and only an admin may create one owned by somebody else or by nobody.
- A reviewer's `team` must name a team on that list. Renaming a team renames it on its reviewers, and deleting one clears it from them. Attention requests already sent keep the name they captured.
- Migration `0008_teams.sql` (D1) and `20261008230603_chilly_invaders` (Postgres) add the `teams` table and turn every team name already on a reviewer into a team with no owner.
- An org carries `defaultRepositoryOwner`, set with `PATCH /api/v1/settings/orgs/current`. The Projects screen starts its owner field from it.
- `/configuration/organization` holds the org's settings, its teams, and (for an admin) the other orgs on the deployment. The reviewer form picks a team from the list.
