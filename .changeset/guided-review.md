---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Guided review: cat-factory's deep dive into one pull request, on its own page.

The page shows cat-factory's overview of the change (summary, focus areas with
line links, risks, what changed, consequences), question threads answered on
their own, a switch to answer from a read-only checkout, and comment drafts
anchored on the diff that can be edited, discarded and posted on the pull
request. It opens from every pull request row on the workspace and
the board.

- `/api/v1/guided-reviews` relays cat-factory's public guided-review surface
  through `@cat-factory/sdk`. Its wire shapes are cat-factory's own schemas,
  imported from `@cat-factory/contracts`.
- Every session is checked against the org that holds the claim on its
  repository before it is read or acted on, so one cat-factory key can serve
  several orgs. Where two orgs hold one repository, the older claim gets its
  sessions, the same rule webhook intake follows.
- A cat-factory refusal carries cat-factory's reason (`repo_not_linked`,
  `thread_busy`, `draft_conflict`, `session_stale`) in `details.reason`, and the
  page says what to do about each.
- `GET /api/v1/guided-reviews/{sessionId}/stream` relays cat-factory's event
  stream for a session as server-sent events, after the same project check. The
  page follows it and re-reads a thread only when its pending answer settles.
  While the stream is down the page polls instead, slowly while it waits on a
  deep answer, which takes minutes.
  A stream refused because its session is gone stops instead of reconnecting.
- `sseStream`'s `end` takes the retry interval to send, so a stream that ended on
  schedule is resumed at once.
- The guided reviewer needs `CAT_FACTORY_BASE_URL` and a key, but no service id.
  `/health` reports it as `capabilities.guidedReview`.
