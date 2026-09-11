---
'@sainte-beuve/app': minor
'@sainte-beuve/server': patch
---

Drive the SPA through the route contracts, and make the reviewer pool editable.

Every call the frontend makes now goes through `sendByApiContract` against the same
contract object `buildHonoRoute` mounts the controller from, so the two halves of a
route cannot drift, and a payload that does not match its schema is refused at the
call rather than three components later.

- `createSainteBeuveApi` is a plain function of a base URL and
  `useSainteBeuveApi` is the two lines that read it out of runtime config, which is
  what lets the boundary have a suite: the cases run in Node against a stubbed
  `fetch`, with no Nuxt around them.
- A refusal keeps the API's own envelope, code and message. A `TypeError` from
  `fetch` is passed through untouched instead of being dressed up as one, because
  "the backend is not running" and "the backend refused" send whoever reads the
  toast to different places.
- A body that fails its contract is restated as the route and the first few field
  paths (`GET /reviewers did not match its contract: reviewers.0.handles: ...`)
  rather than surfacing the underlying JSON dump of every issue. The same gate runs
  on the way out, so a request the contract forbids never leaves the browser.
- The attention stream stays an `EventSource`, which reconnects by itself after a
  laptop closes, and takes its URL from the stream contract rather than a typed-out
  path.
- The first drift it caught: `assignReviewers` was hand-typed as `{ assigned }`
  while the route answers `{ review, assigned, shortfallReason }`, so an assign
  that found nobody with the required skills read as a success and said nothing.
  The board now reports the shortfall the route hands back.
- The Reviewers screen manages the pool: add somebody, edit their skills, team,
  per-host handles, Slack id and weight, and pause or resume them in one click. No
  delete, deliberately: `paused` keeps the row, and the row is what a review's
  assignment and a linked host account point at.
- A server suite covers the reviewer directory routes, including that a patch
  replaces the whole handles map and that `outstandingReviews` cannot be set
  through it.
