---
'@sainte-beuve/contracts': minor
'@sainte-beuve/persistence-conformance': patch
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': patch
---

One matching rule. An attention request nobody was named on reaches whoever holds at least half of what it wants (`ATTENTION_FIT_FLOOR`), measured as the share of wanted skills and domains that also ranks the recommendations and weights the board's draw. An ask captures what it wants when it is raised: the picked skills, else the pull request's board row's, else the repository's, and the repository's domains. The next best match a named ask moves on to is ranked against that stored mix, and the DM a recipient gets names what of it they hold. An ask nobody was named on is refused when nobody available who could otherwise be asked holds half of what it wants.

`AttentionRequest` gains `domains`, defaulting to none, so an ask raised before this release keeps the skills it was raised with and no domains: one that picked two skills reaches whoever holds either of them until it is answered.

`@sainte-beuve/reviewers` replaces `hasAllSkills` with `affinityOf`, `fitsWanted`, `wantsNothing` and `wantedOf`, and `AttentionAudienceRule.requiredSkills` with `wanted: MatchTarget`.
