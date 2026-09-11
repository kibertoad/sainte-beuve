---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': patch
'@sainte-beuve/app': patch
---

Say why an assign found nobody, and stop the reviewer form losing work.

An assign that put nobody on the row had two reasons to give and five situations to
give them for, so four of the five were told that nobody holds the required skills.
The reviewer form, meanwhile, dropped an operator's edits on any background refetch
and reverted concurrent changes on save.

- Five shortfall reasons where there were two: an empty directory, an all-paused
  pool, a skill nobody available holds, a candidate list emptied by the author and
  already-assigned exclusions, and a pool smaller than the number asked for.
  `diagnoseShortfall` in `@sainte-beuve/reviewers` decides which, pure and over the
  same candidate list the scorer filtered, checked coarsest cause first so a paused
  pool is never reported as a skills problem.
- `shortfallCause` and `shortfallRemedy` in `@sainte-beuve/contracts` are the only
  copies of the wording. `botReply` and the board each add the tail their channel
  owns, so the comment on the pull request and the toast on the screen cannot drift,
  which the two hand-written tables they replace had already done.
- `pool_exhausted` means what its name says. It was unreachable at `count: 1`, the
  only count the board and the webhooks send, so nobody had seen its message.
- The reviewer form is seeded once and never refilled from its prop. A refetch used
  to replace the draft mid-edit, which is every click of Pause on another row and
  every press of Refresh.
- A save sends only the fields that form moved, diffed against the row as it was when
  Edit was pressed. Both a whole-row patch and a diff against the current row revert
  what somebody else changed while the form was open.
- The edit target is released when the list no longer holds it, so a failed refresh
  cannot leave every Edit button disabled with nothing on screen explaining why.
- `app/utils/reviewerDraft.ts` and `app/utils/text.ts` hold the draft conversions and
  the two parsing rules the forms share, which is what gives them a suite: the cases
  run in Node with no Nuxt around them.
- One `ApiErrorAlert` for every failed fetch. Two screens rendered nothing and told
  the operator their list was empty, and two hardcoded "Is the backend running?",
  which is the wrong question when the API answered and broke its contract.
- A 400 names the field it refused. `issuePath` in `@sainte-beuve/contracts` is now
  the one reader of a Standard Schema issue path, so the envelope's `details` carries
  a field name a person can act on rather than `[object Object]`, and
  `apiErrorMessage` folds it into the message.
- Stream events go through `attentionEventSchema`, which is the one body that reached
  a component unchecked. Nothing else validates it: `buildHonoRoute` validates
  requests only, and a stream does not go through `sendByApiContract`.
- A request the client itself refuses reports `invalid_request` rather than
  `contract_mismatch`, so a value somebody typed is not presented as the route
  breaking its contract.
- A reviewer's weight has to be above 0, by the check and not only by the comment
  beside it. A stored 0 was a person `isEligible` dropped from every draw while their
  row still rendered as available.
- `parseSkills` and `blankToNull` have one home. They had four copies between them
  across three screens, so a change to how a blank box or a trailing comma is treated
  had to be found in each.
- One API client per base URL. Seven call sites asked for one, one of them per
  expanded board row, and each built a fresh wretch instance and a closure per
  method. Safe to cache only because the app is `ssr: false`, which the comment says.
