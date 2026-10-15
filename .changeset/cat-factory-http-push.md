---
'@sainte-beuve/server': patch
---

An `http` `API_BASE_URL` is offered to cat-factory as a push address instead of being
refused here, since a local cat-factory accepts one for `localhost` (from the release
that carries [kibertoad/cat-factory#2374](https://github.com/kibertoad/cat-factory/pull/2374)). When cat-factory
refuses it, the warning names the cat-factory settings that allow it.
