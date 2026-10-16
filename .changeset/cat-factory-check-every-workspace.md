---
'@sainte-beuve/ai-review': patch
'@sainte-beuve/server': patch
---

Test connection works with a cat-factory key that reaches several workspaces. cat-factory refuses
`GET /api/v1/me`, `/services` and `/pipelines` from such a key with `422 workspace_required` unless
it names a workspace, so the check now lists the key's workspaces from the account-scoped
directory and asks in each. A failed step names the request that failed and cat-factory's reason,
for example `GET /api/v1/me: HTTP 422 (validation, workspace_required)`.
