---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

My PRs lists the viewer's open pull requests in every repository, not only the registered projects.

- `GET /api/v1/my-pull-requests` takes `scope`: `all` (the default) adds what a host search finds outside the registered projects, `linked` keeps to them. The response carries `searches`, one per host searched.
- A row outside the registered projects has `projectId: null` and `merge.direct: 'unlinked'`. The screen offers an admin a button to link its repository.
- `VcsGateway` gains `listAuthoredOpenPullRequests`, implemented for GitHub (search API) and GitLab (`/merge_requests?scope=all`). A GitHub App installation answers an empty list.
