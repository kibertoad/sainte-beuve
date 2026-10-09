---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

My Reviews: other people's open pull requests the viewer was asked to review, committed to, or has reviewed.

- `GET /api/v1/my-reviews` answers `requested`, `committed` and `reviewed`, each row with its `projectId` or null. It takes `scope` (`all` or `linked`) and `owner`.
- On GitLab, `reviewed` means approved, since GitLab records no review short of an approval.
- `workspaceScopeSchema` and `hostSearchSchema` move to the workspace contract, shared by My PRs and My Reviews.
