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
- The repository field is an autocomplete: free text, with the matches in a dropdown 300 ms after typing stops. The dropdown says when the owner does not exist.
- Skills on the Repositories screen and in the reviewer form are removable chips. Typing offers the skills already in use on repositories and reviewers, and anything else is added as a new skill.
