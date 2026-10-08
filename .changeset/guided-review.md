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
anchored on the diff. It opens from every pull request row on the workspace and
the board.

- `/api/v1/guided-reviews` relays cat-factory's public guided-review surface
  through `@cat-factory/sdk`. Its wire shapes are cat-factory's own schemas,
  imported from `@cat-factory/contracts`.
- Every session is checked against the org's registered projects before it is
  read or acted on, so one cat-factory key can serve several orgs.
- A cat-factory refusal carries cat-factory's reason (`repo_not_linked`,
  `thread_busy`) in `details.reason`.
- The guided reviewer needs `CAT_FACTORY_BASE_URL` and a key, but no service id.
  `/health` reports it as `capabilities.guidedReview`.
