---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/app': minor
---

cat-factory is configured per org, on the Configuration screen, and no longer from the environment.

- `CAT_FACTORY_BASE_URL`, `CAT_FACTORY_SERVICE_ID`, `CAT_FACTORY_PIPELINE_ID` and `CAT_FACTORY_API_KEY` are no longer read. Each org stores its base URL, service id and pipeline id (`PUT /api/v1/settings/connections/cat-factory`) beside its sealed key. A deployment that set them in the environment has to enter them on the Configuration screen after upgrading. The Node server warns at boot, and the Worker once per isolate, when any of them is still set.
- An org no longer falls back to the deployment's cat-factory key, so one org cannot spend another's budget.
- The stored key is bound to the stored base URL. Saving a different base URL removes it, and so does clearing the settings, so a key is never sent to an instance other than the one it was entered for.
- `POST /api/v1/settings/connections/cat-factory/check` tries a configuration against its instance and lists the services and pipelines the key can see. It uses the stored key only against the stored base URL; any other URL needs the key pasted with it. A failed check names the kind of failure (an HTTP status, no connection, not a cat-factory answer) and never echoes what the server answered.
- Polling, curating and resuming an AI review run need the key and base URL but no service id, so clearing the service id stops new reviews without stranding the runs in flight. `CatFactoryReviewTarget.serviceId` is nullable, and filing refuses without one.
- `GET /api/v1/capabilities` tells any member whether AI review and guided review can run, and the board and guided review page warn when they cannot.
- New `IntegrationConfigRepository` port (`integrationConfigs`) in all three stores, with a D1 migration and a Postgres migration for the `integration_configs` table.
- `GatewayFactory.aiReview` and `guidedReview` take the org's connection instead of a key, and `catFactoryProbe` is new. `catFactoryGateways()` in `@sainte-beuve/ai-review` builds all three.
- Local mode suggests a local cat-factory's defaults (`http://localhost:8787`, `pl_review`), and the SPA's dev server moves from port 3000 to 3088.
