---
'@sainte-beuve/persistence-memory': patch
'@sainte-beuve/local-server': patch
'@sainte-beuve/node-server': patch
'@sainte-beuve/ai-review': minor
'@sainte-beuve/reminders': patch
'@sainte-beuve/reviewers': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': patch
'@sainte-beuve/app': patch
---

Fix the review findings from the first pass over the bootstrap tree.

- CORS answered no `Access-Control-Allow-Origin` at all on the wildcard default,
  because Hono only returns `*` for the string and every runtime passed `['*']`.
  `AppOptions.corsOrigins` now also takes a callback, and `resolveContainer`
  receives the runtime's bindings, so a Worker builds the app once per isolate
  instead of once per request. The invalid `credentials: true` beside a wildcard
  origin is gone.
- The reminder ladder works. The escalation used to pre-empt every earlier rung
  for any review that merely had a deadline; the policy now plans whichever
  candidate falls due first. The tick re-plans after each send, so a review gets
  its whole ladder rather than one nudge, and a nudge that cannot be delivered is
  recorded as `failed` with the reason instead of silently `cancelled`.
- `updateStatus` moves the reviewers' outstanding counters on the transition, so a
  replayed close no longer decrements twice and reopening a review restores them.
- The author is excluded from their own review case-insensitively, through the new
  `isSameGithubLogin` in `@sainte-beuve/reviewers`.
- `AiReviewGateway.getStatus` returns `AiReviewReport`: the verdict in `summary`,
  the fault in `failureReason`, and `cancelled` when a run was cancelled rather
  than reporting it as running for ever.
- The in-memory stores clone what a patch hands them, matching the copy invariant
  the reads already keep.
- The Worker's `scheduled` handler logs a failed tick like the other two facades,
  and local mode delegates to the Node facade instead of duplicating its
  serve/tick/shutdown path.
- The board surfaces a refused assign or AI-review request instead of swallowing
  the rejection.
