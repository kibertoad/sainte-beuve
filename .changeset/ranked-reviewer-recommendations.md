---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Reviewer recommendations. `POST /api/v1/reviewers/recommendations` ranks the reviewers who fit a pull request best, using the same score the automatic assignment draws with, and names each one's matched skills, matched domains and open reviews. The Ask for attention dialog shows the top five for the pull request and the skills picked.

`ScoredCandidate.matchedSkills` and `matchedDomains` in `@sainte-beuve/reviewers` are now the matched names instead of counts, and `rankCandidates` lays the scored pool out best first.
