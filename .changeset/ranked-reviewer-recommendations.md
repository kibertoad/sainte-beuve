---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Reviewer recommendations. `POST /api/v1/reviewers/recommendations` ranks the reviewers an ask for attention could reach on a pull request, best fit first and fewer open reviews among equal fits, and names each one's matched skills, matched domains and open reviews. It leaves out the caller, the author, and whoever the board or the host already has on the pull request, and honours `sameTeamOnly`. The Ask for attention dialog shows the top five for the pull request and the skills picked.

`ScoredCandidate.matchedSkills` and `matchedDomains` in `@sainte-beuve/reviewers` are now the matched names instead of counts, `ScoredCandidate.affinity` is the share of the wanted mix held, and `rankCandidates` lays a pool out best first. `excludedFromReview` and `reviewersWithHandles` are the exclusion rule review assignment and recommendations share.
