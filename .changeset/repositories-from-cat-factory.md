---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/integrations': patch
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/app': minor
---

Repositories come from cat-factory when it is configured.

- An org with a cat-factory base URL and key watches the repositories linked in its cat-factory workspaces. Adding or removing one in sainte-beuve answers 409 (`repositories_managed_externally`); skills, domains and merge settings stay editable.
- The first sync adopts matching projects and removes every project cat-factory does not link.
- The clock follows cat-factory's directory change feed every five minutes and walks its snapshots daily. A signed push to `POST /webhooks/cat-factory/<org-slug>` applies a change at once; sainte-beuve registers that webhook itself when the key has the `admin` scope and `API_BASE_URL` is public.
- `POST /api/v1/settings/connections/cat-factory/sync` syncs now. The cat-factory connection reports `repositorySync`, and capabilities report `repositoryDirectory`.
- New table `external_repositories`, keyed `(org_id, source, key)`: D1 `0009_external_repositories.sql`, Postgres `20261012002248_true_electro`. A project carries an optional `external: { source, id }`.
- `@cat-factory/sdk` moves to `^0.57.0` and `@cat-factory/contracts` to `^0.366.0`; `@cat-factory/directory-sync` and `@cat-factory/webhooks` are new dependencies of `@sainte-beuve/ai-review`.
