---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': patch
'@sainte-beuve/app': minor
---

Domains: what a repository is about and what a reviewer knows, matched when a review is assigned.

- An org keeps a list of `domains`, edited on the Organization screen. A repository and a reviewer each carry `domains` too. All three are optional on stored rows and read back as `[]`, so no migration is needed.
- Registering or editing a repository with a domain the org does not have adds it to the org's list, in the spelling given. A domain that differs from a known one only by case takes the known spelling.
- A repository's domains count in reviewer matching alongside its skills. See `reviewer-match-scoring` for how.
- The reviewer form picks domains from the known ones and cannot create one.
