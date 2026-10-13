---
'@sainte-beuve/ai-review': patch
---

Depend on `@cat-factory/directory-sync` 0.2.1 and `@cat-factory/webhooks` 0.2.0.
`directory-sync` now takes the SDK as a peer, so the workspace resolves one SDK
without the pnpm override it needed while 0.1.0 pinned the SDK to 0.56.3.
