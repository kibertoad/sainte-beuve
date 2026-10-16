---
'@sainte-beuve/contracts': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/app': minor
---

An AI review for a repository no cat-factory service backs, with no default service set, now
refuses with `details.reason: cat_factory_repository_missing` and a link into cat-factory's
add-service window with the repository picked. The error toast offers "Add owner/repo in
cat-factory" and then "Retry". The app URL comes from cat-factory's `GET /api/v1/deployment`,
falling back to the configured base URL. The window opens prefilled only on a cat-factory release
carrying kibertoad/cat-factory#2379; an older one opens the app at its board.
