---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

My PRs offers "Resolve conflicts" on a pull request whose branch conflicts with its base, and hands it to cat-factory's conflict resolver.

- `POST /api/v1/my-pull-requests/resolve-conflicts` takes `{ projectId, number }` and answers with the cat-factory task and its link. Like a merge, it acts only on a pull request the caller authored, and it refuses one that has no conflicts.
- `AiReviewGateway.requestConflictResolution` files a cat-factory task of type `resolve-conflicts`, naming the pull request in `fields.prNumber`, and starts it on that task type's own pipeline rather than the review pipeline a deployment pins.
- The button shows when the org has cat-factory configured. It needs a cat-factory instance serving public API 1.79.0 or later, which added the `resolve-conflicts` task type; an older instance refuses the task by name.
- `@cat-factory/sdk` moves to ^0.56.3 and `@cat-factory/contracts` to ^0.363.0, the releases that know the task type.
