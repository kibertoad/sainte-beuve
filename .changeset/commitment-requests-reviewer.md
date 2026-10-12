---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/reviewers': patch
---

A commitment requests the reviewer on GitHub or GitLab, and releasing it takes that request back when the commitment made it and the reviewer has not reviewed yet. A request the host already had, or one a board assignment of the same person relies on, stays. A board reroll leaves the host request of anybody who has committed to that pull request, and their commitment takes it over. My Reviews lists a pull request you committed to under Committed to reviewing only, not again under Asked to review.

`VcsGateway` gains `pendingReviewers`, the handles the host is still waiting on, and `requestReviewers` answers the logins it put a request on. A `ReviewCommitment` carries `requestedHandle`, the handle it requested on the host, which reads `null` on rows stored before this. `ReviewCommitmentRepository` gains `setRequestedHandle`.
