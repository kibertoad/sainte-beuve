---
'@sainte-beuve/contracts': minor
'@sainte-beuve/ai-review': patch
'@sainte-beuve/server': patch
---

Links into cat-factory from an AI review and from a conflict resolution open the task's run on its
board in cat-factory's app: `?ws=<workspace>&block=<task>&run=<run>` on the app URL, which is the
deep link cat-factory's app reads. They pointed at `/tasks/<id>` on whatever URL was configured at
filing, a path the app does not have, and on the API's origin when no app URL was set yet. A run's
link is now built when it is read, from the app URL as configured and the run id the polls learnt,
so runs filed before an app URL was set link correctly too. `catFactoryRunUrl` in
`@sainte-beuve/contracts` builds it.
