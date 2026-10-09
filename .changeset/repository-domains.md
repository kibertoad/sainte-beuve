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
- Selection stays gated on skills. Among the reviewers who pass, a reviewer who knows all of the repository's domains is drawn `1 + DOMAIN_PREFERENCE` (3) times as often as one who knows none, and knowing some of them earns a proportional share. A review on a repository nobody registered draws as before.
- On the Repositories screen, the Add form and each repository take domains as chips, and a new one can be typed in. The reviewer form picks from the known domains and cannot create one.
