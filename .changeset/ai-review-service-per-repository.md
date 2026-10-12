---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

An AI review is filed under the cat-factory service that backs its repository, in the workspace that links it, instead of under the one service id an org sets.

- `AiReviewGateway.requestReview` takes `directoryKeys`, the keys the org's repository mirror holds the repository under. `CatFactoryAiReviewGateway` reads the workspace from each key, asks that workspace's `GET /api/v1/repos` which service backs the repository, and files the task there. A repository no service backs, such as a monorepo, goes under the org's service id, which is now a fallback. With neither, filing is refused naming both fixes. A refused workspace lookup is reported, never answered with the fallback.
- `AiReviewHandle.workspaceId` says where the task landed. A run stores it as `catFactoryWorkspaceId` (payload only, defaulting to null for runs filed before), and `getStatus`, `dismissFinding`, `resolveReview` and `resumeReview` take it, so a key that reaches several workspaces can drive a run in any of them. `getStatus` takes `{ taskId, workspaceId }` instead of a bare task id.
- `resolveAiReview` no longer needs a service id, so `GET /api/v1/capabilities` and the cat-factory connection's `aiReviewReady` report AI review as available once the base URL and key are set.
- The Configuration screen calls the field "Default service id" and marks it optional.
