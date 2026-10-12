---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/app': minor
---

An attention ask can be declined. `POST /attention/:id/decline` records who passed and why on the ask's new `declines`, takes it out of the decliner's inbox and re-renders their DM, which now carries a "Not me" button beside "I will review it". Committing after declining clears the decline.

A named ask the declines leave short moves on to the next best match from the reviewer recommendations: by itself when the requester raised it with `keepAsking`, which the dialog ticks by default, and otherwise through `POST /attention/:id/recipients`, the requester's "Ask the next best match", which also takes named ids. The people added get the ask in their inbox and as a DM. The stream gains the `declined` and `asked` event kinds, and `SLACK_ACTIONS` gains `attentionDecline`.
