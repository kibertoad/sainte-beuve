---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': patch
'@sainte-beuve/app': minor
---

Challenge a finding of a parked AI review.

- `POST /api/v1/ai-review/runs/:runId/findings/:findingId/challenge` sends one
  finding to cat-factory's investigator, with an optional question. It answers
  202 with the run back in flight; the verdict arrives on a later read.
- Each finding carries `challenge`: `investigating`, then `upheld`, `amended`,
  `retracted` or `failed`, with the question and the investigator's grounding.
  The field defaults to null, so runs stored before it still read.
- `AiReviewGateway` gains `challengeFinding`.
- `decideChallengeAdmission` in `@sainte-beuve/reviewers`: one challenge per
  finding (again after a failure), one at a time, five findings per review
  (`AI_REVIEW_CHALLENGE_LIMIT` in `@sainte-beuve/contracts`).
- Each run records `challengedFindingIds`, so a dismissed finding still counts
  against the five. It defaults to empty for runs stored before it.
- A verdict that lands between two polls re-parks the review, and a poll older
  than a challenge no longer writes the finding back unchallenged.
- A resolution naming a retracted finding answers 400.
- The curation verbs move to `AiReviewCurationService`. The board's finding rows
  gain Challenge and show the verdict.
