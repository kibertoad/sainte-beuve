---
'@sainte-beuve/contracts': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

The "Mint a key in cat-factory" link asks for a key whose reach follows the person's workspace
memberships (`reach=memberships`, cat-factory 1.89 public API), so one personal key covers every
workspace they are in. A filing cat-factory refuses with `workspace_not_found` on the person's key
answers `need: workspace`, and the prompt says the key does not reach the repository's workspace.
