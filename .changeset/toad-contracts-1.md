---
'@sainte-beuve/contracts': patch
'@sainte-beuve/server': patch
'@sainte-beuve/app': patch
---

Move to `@toad-contracts` 1.x. `frontend-http-client` 1.0.1 leaves a query param that is `undefined` out of the URL instead of sending it empty, which the My PRs filters were refused for.
