---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/local-server': patch
'@sainte-beuve/app': minor
---

The cat-factory settings take an optional app URL beside the API URL, for a deployment that serves
its web app on a different origin. The "Add owner/repo in cat-factory" link and the task link use
it, so they no longer land on an API route that answers `unauthorized`. Left blank, the app URL is
asked of cat-factory's `GET /api/v1/deployment` and then falls back to the API URL.
