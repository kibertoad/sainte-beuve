---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

My PRs: the viewer's ten most recently updated open pull requests, and merging them.

- `GET /api/v1/my-pull-requests` filters by `status` (`awaiting` by default, `approved`, `draft`), `owner` and `projectId`. Each row carries its approval and merge state, read from the host.
- `POST /api/v1/my-pull-requests/merge` merges at an expected head sha. `POST /api/v1/my-pull-requests/merge-comment` posts one of the merge comments in force. Both act only on a pull request the caller authored.
- `VcsGateway` gains `pullRequestStatus` and `merge`, implemented for GitHub and GitLab. A GitHub App needs `Contents: Read & write` to merge.
- Merge comments are set on the org (`mergeComments`), and a team or a project can replace them (`null` inherits). A project's `restrictDirectMerge` refuses a direct merge while merge comments are in force; an admin can override it with `override: true`.
- No migration: the new fields live in the stored payloads, and older rows read as no merge comments.
