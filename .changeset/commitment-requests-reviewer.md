---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': patch
---

A commitment requests the reviewer on GitHub or GitLab, and releasing it takes that request back when the commitment made it and the reviewer has not reviewed yet. A request the host already had, or one a board assignment of the same person relies on, stays.

`VcsGateway` gains `pendingReviewers`, the handles the host is still waiting on. A `ReviewCommitment` carries `requestedOnHost`, which reads `false` on rows stored before this.
