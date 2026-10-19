---
'@sainte-beuve/contracts': patch
'@sainte-beuve/kernel': patch
'@sainte-beuve/ai-review': patch
'@sainte-beuve/server': patch
---

Every link into cat-factory's app now resolves the app URL one way: the configured app URL, else what
the instance answers on `GET /api/v1/deployment`, else its API base URL. The run links on AI reviews
and the personal key link used to skip the instance and fall straight to the API base URL. All of
them, the add-service link included, are built by one helper, `catFactoryAppLink`.

An AI review on a repository no cat-factory board has now offers the add-service link when the key may
not link the repository itself (cat-factory requires `admin` for that), instead of failing with a
scope refusal that named the wrong scope.
