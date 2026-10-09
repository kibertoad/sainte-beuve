---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Reviewer assignment scores skills and domains together instead of requiring every skill.

- Every available reviewer is a candidate. Their draw weight is multiplied by `1 + MATCH_PREFERENCE * affinity`, where the affinity is the share of the wanted skills and domains they hold, so holding all of them is five times as likely as holding none. Load and weight damping apply as before.
- The wanted skills are the review's own `requiredSkills`, or the repository's skills when the review names none. The wanted domains are the repository's.
- `no_skill_match` is gone from `ShortfallReason`: a review is no longer left unassigned for want of a skill. `isEligible` and `diagnoseShortfall` no longer take skills, and `selectReviewers` takes `skills` and `domains` in place of `requiredSkills` and `preferredDomains`.
- Attention requests still address only people holding every skill they ask for, since a broadcast has nothing to rank.
- On the Repositories screen, the Add form takes skills (starting from the defaults) and domains, the same pair each repository shows for editing.
