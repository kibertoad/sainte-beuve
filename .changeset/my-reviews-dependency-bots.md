---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/app': minor
---

My Reviews hides pull requests opened by Dependabot or Renovate by default, as PRs to review does.
`GET /my-reviews` takes `dependencyBots=show` to list them, and the screen has a switch for it.
A commitment to one of them is always listed.
