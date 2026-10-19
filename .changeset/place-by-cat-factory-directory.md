---
'@sainte-beuve/ai-review': patch
'@sainte-beuve/kernel': patch
'@sainte-beuve/server': patch
---

Assessing a pull request whose repository the org's mirror does not list yet now asks cat-factory's
directory which workspace links it, and names that workspace. A key reaching several workspaces was
refused with `422 workspace_required` before. AI review placement reads the directory the same way.

A repository no cat-factory workspace links is refused with the add-service link
(`cat_factory_repository_missing`) when it is assessed, as an AI review already was, so the toast
offers to add it in cat-factory. So is an assessment cat-factory answers with `repo_not_linked`, and
an AI review whose mirror key names a workspace cat-factory no longer has. The risk gateway takes
the org's `appUrl` for that link.
