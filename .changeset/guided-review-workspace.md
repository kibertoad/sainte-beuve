---
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
---

A guided review names the cat-factory workspace it lives in, so it works with a key that reaches several workspaces.

- `GuidedReviewGateway.find` and `open` take `directoryKeys`, the keys the org's repository mirror holds the pull request's repository under. A session is looked up in each workspace those keys name and opened in the first by id when none holds one.
- `GatewayFactory.guidedReview` takes `CatFactoryGuidedReviewAccess`, which adds `directoryKeys()`: every key the org mirrors, read only when a call by session id has to find the session's workspace. With one workspace it is named outright; with several, the session is read in each and the one that answers holds it.
- The guided-review port moves to `ports/guided-review.ts` in the kernel. The package root still exports it.
