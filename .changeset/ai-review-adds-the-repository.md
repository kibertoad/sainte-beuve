---
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

AI review is offered on every pull request row, including those in a repository nobody registered.
Filing one for a repository no cat-factory workspace links now links it and creates a service for
it, in the workspace most of the owner's other repositories are in, else the key's only workspace,
and then follows the directory so the repository is registered here at once. Creating the service
needs a key with the `admin` scope. With a `decide` key, a monorepo, or no single workspace to pick,
the review falls back to the default service as before, else to the "Add owner/repo in cat-factory"
link. `requestReview` and `requestConflictResolution` take `ownerDirectoryKeys`.
