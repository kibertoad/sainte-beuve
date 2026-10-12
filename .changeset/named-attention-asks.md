---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Named attention asks. `CreateAttentionRequest` takes `recipientIds`, and an `AttentionRequest` carries the `recipients` it named. A request with recipients reaches exactly those people, and the skill and team gate applies only to one without. The server refuses a name that is not in the directory, is paused or is the requester, and an ask waiting for more people than it names. The Ask for attention dialog makes the ranked matches tickable, and the inbox shows who was asked.

`AttentionAudienceRule` in `@sainte-beuve/reviewers` gains `recipientIds`.
