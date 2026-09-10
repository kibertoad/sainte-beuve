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
  served from the store would show a review that parked an hour ago as running. A
  poll writes onto the row as it stands rather than the one it started from, so
  the older of two answers in flight cannot walk a settled run back into flight,
  and a poll that was refused leaves the reason on the row instead of only in a
  log line nobody reading the board will see.
- The receipt outlives the decision. cat-factory drops a decision from the run's
  list the moment the loop settles, so the poll that sees a review finish is the
  poll that sees no decision, and a row that wrote that through would lose the
  post report and the findings at the moment somebody wants to read what landed.
- A cat-factory refusal keeps its shape, filing included: 409 for a review that
  moved on, 404 for a finding a stale screen clicked twice, 403 naming the
  `decide` scope a key needs, 403 for a key that has been revoked, 503 for an
  instance at capacity (where making the same call again is the answer) or one
  missing a credential of its own, 400 for a rule it broke. Only a fault is
  reported as upstream. A run whose cat-factory run has not appeared yet answers
  409 rather than 404, because "poll again" and "this is gone" are opposite
  instructions.
- The AI-review reads sit behind the same CORS rule as a write, not the wildcard
  that covers reads: answering one polls cat-factory with the deployment's key and
  writes what it learns, so a page an operator happens to visit must not be able
  to lift a private pull request's findings or loop the request.
- The board expands a row onto its reviews: severities, the line each finding is
  about, the suggested fix, checkboxes (the recorded selection, else blockers and
  highs), and the three ways out. A failed pass says which comments bounced and
  why, a summary comment that did not land included. A review waiting on a person
  is polled at a slower cadence than one a model is working on.
- `@cat-factory/sdk` moves to ^0.52.0, which is where the resume route and the
  post receipt are published.
