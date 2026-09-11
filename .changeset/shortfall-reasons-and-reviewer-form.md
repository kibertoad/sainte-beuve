---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': patch
'@sainte-beuve/app': patch
---

Say why an assign found nobody, in wording both channels read from one place.

An assign that put nobody on the row had two reasons to give and five situations to
give them for, so four of the five were told that nobody holds the required skills.
`shortfallReason` now names the cause it found, and the sentence for each cause lives
in `@sainte-beuve/contracts` beside the schema.

- Five reasons where there were two: an empty directory, an all-paused pool, a skill
  nobody available holds, a candidate list emptied by the author and already-assigned
  exclusions, and a pool smaller than the number asked for. `diagnoseShortfall` in
  `@sainte-beuve/reviewers` decides which, pure and over the same candidate list the
  scorer filtered, checked coarsest cause first so a paused pool is never reported as
  a skills problem.
- `shortfallCause` and `shortfallRemedy` are the only copies of the wording.
  `botReply` and the board each add the tail their channel owns, so the comment on
  the pull request and the toast on the screen cannot drift apart, which the two
  hand-written tables they replace had already done.
- `pool_exhausted` means what its name says. It was unreachable at `count: 1`, which
  is the only count the board and the webhooks send, so the message behind it had
  never been seen.
