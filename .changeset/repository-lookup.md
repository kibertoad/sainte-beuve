---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

The Projects screen is now the Repositories screen, and its Add form suggests repositories as you type.

- The screen lives at `/repositories`. `/projects` still opens it.
- `GET /api/v1/repositories/lookup?provider&owner&query` answers whether the owner exists on the host and which of its repositories have names matching `query` (at least three characters). It is an admin's read, because the answer lists private repositories the credential can see.
- `VcsGateway.lookupRepositories(owner, query)` is new on the port. GitHub checks the owner with `GET /users/{owner}` before spending a search; GitLab resolves the namespace and lists the group's or the user's projects. A GitHub App installation answers null, and the route answers 503 saying a sign-in or a token is needed.
- The form asks 300 ms after typing stops, once an owner is set, and says when the owner does not exist.
