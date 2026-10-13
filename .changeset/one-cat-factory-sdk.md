---
'@sainte-beuve/ai-review': patch
---

Depend on `@cat-factory/directory-sync` 0.2.1, which takes the SDK as a peer, so
the workspace resolves one SDK without the pnpm override it needed while 0.1.0
pinned the SDK to 0.56.3. `@cat-factory/webhooks` is no longer a direct
dependency: nothing here imports it, and `directory-sync` brings the copy that
verifies its pushes.
