---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

A guided review names the cat-factory workspace it lives in, so it works with a key that reaches several workspaces.

- Every guided-review route about a session takes the pull request it is about in the query (`provider`, `owner`, `repo`, `number`), the same parameters as the lookup. A session named with a pull request it is not about reads as not found. `isGuidedReviewFor` and `guidedReviewTargetOf` relate a session to its pull request.
- `GuidedReviewGateway.find` and `open` take `directoryKeys`, the keys the org's repository mirror holds the pull request's repository under. A session is looked up in each workspace those keys name and opened in the first by id when none holds one.
- The gateway's calls about a session take a `GuidedReviewSessionRef`: the session id and the same `directoryKeys`. With one linking workspace it is named outright; with several, the session is read in each and the one that answers holds it.
- The guided-review port moves to `ports/guided-review.ts` in the kernel. The package root still exports it.
