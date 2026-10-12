---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/persistence-d1': patch
'@sainte-beuve/persistence-postgres': patch
'@sainte-beuve/reviewers': minor
---

A named attention ask reaches each recipient with a Slack id as a DM from the org's Slack app, saying who asks, for which pull request and what of the ask they match, with an "I will review it" button. The button commits through the same path as the inbox. The DMs follow the ask: the committer's says so, and every one is updated when the ask resolves or is withdrawn, so no button is left on a closed ask. An org without Slack, and an ask addressed by the skill gate, send none.

`ChatGateway` gains `sendAttentionAsk` and `updateAttentionAsk`, `AttentionRequest` carries the `chatDeliveries` it went out as, and `SLACK_ACTIONS` gains `attentionCommit`.

`resolveAttentionRecipients` answers with the named people's directory entries (`reviewers`), so the caller can reach them. `AttentionRepository.update` merges its patch in one statement on every store, so recording where an ask's DMs landed and a commit to it both survive however they interleave.
