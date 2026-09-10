---
'@sainte-beuve/ai-review': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Drive the whole AI review through cat-factory, instead of filing one and hoping.

A `review` task parks on its findings and posts nothing until somebody says which
of them are worth a comment. That middle step is now a surface rather than a gap.

- `AiReviewGateway` gains the three curation verbs cat-factory's decision surface
  exposes (dismiss a finding, resolve the selection as `post` / `fix` / `finish`,
  resume a stalled reviewer). Filing is addressed by TASK because that is what we
  hold after a request; everything after it by RUN, which is what cat-factory keys
  the decisions on, so `getStatus` reports the run id a poll learnt.
- `awaiting_selection` is a run state of its own. A review waiting on a curator
  and a review whose fixer is mid-pass are both `blocked` upstream and need
  opposite things from a screen.
- The curation projection carries `postReport` beside `postAttempts`. A `post`
  that lands nothing re-parks the review with the selection cleared, which is
  byte-for-byte a review nobody has curated, so without the receipt a caller reads
  back the state it held a moment earlier and reports success. `folded` is counted
  apart from `posted` because a finding moved into the summary comment did reach
  the pull request, and `postedFindingIds` is what a retry skips.
- Four routes under `/api/v1/ai-review/runs/:runId`, mounted through their
  contracts: read one run, dismiss a finding, resolve, resume. Every read POLLS
  whatever is still in flight, because cat-factory calls nothing back and a list
  served from the store would show a review that parked an hour ago as running.
- A cat-factory refusal keeps its shape: 409 for a review that moved on, 404 for a
  finding a stale screen clicked twice, 403 naming the `decide` scope a key needs,
  400 for a rule it broke. Only a fault is reported as upstream.
- The board expands a row onto its reviews: severities, the line each finding is
  about, the suggested fix, checkboxes (blockers and highs pre-ticked), and the
  three ways out. A failed pass says which comments bounced and why.
- `@cat-factory/sdk` moves to ^0.52.0, which is where the resume route and the
  post receipt are published.
