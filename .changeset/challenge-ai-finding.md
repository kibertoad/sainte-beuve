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
  finding (again after a failure), one at a time, five verdicts per review.
- A resolution naming a retracted finding answers 400.
- The curation verbs move to `AiReviewCurationService`. The board's finding rows
  gain Challenge and show the verdict.
