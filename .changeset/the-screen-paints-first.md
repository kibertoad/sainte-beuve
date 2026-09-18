---
'@sainte-beuve/app': minor
---

The SPA stops serialising its own first paint.

Every screen was two sequential round trips behind a click, and Configuration
three, for no benefit: with `ssr: false` there is no hydration to protect, so an
awaited read at setup buys nothing and costs the whole wait.

- **The shell no longer suspends on `GET /auth`.** It awaited the auth read
  before `<NuxtPage>` mounted, so a page's own fetch could not even be issued
  until the answer was down. It is started and not awaited; the rail already
  renders around a null answer, and now the two reads overlap.
- **Pages read lazily and say what they are waiting for.** `useAsyncData(...,
{ lazy: true })` on the workspace, board, projects, reviewers and configuration
  screens, with a `LoadingCard` skeleton shaped like the rows that are coming.
  Awaited, Suspense held the PREVIOUS screen on screen until the list was down,
  validated and mounted, so clicking a destination looked like nothing had
  happened. `AiReviewPanel` has worked this way since it was written; this is the
  rest of the app catching up.
- **The auth read de-duplicates in flight.** Configuration needs the answer
  before it decides whether to ask for the admin-only half, and used to
  re-request it — a third hop for something already on its way. `refresh()` now
  returns the read that is running, and the page asks only when nothing has read
  it yet.
- **The API origin is preconnected from the generated HTML.** The first act of
  every screen is a cross-origin call, and without a hint the browser met DNS,
  TLS and a CORS preflight in series at that first fetch instead of overlapping
  them with the bundle download. `crossorigin="use-credentials"`, because every
  call this SPA makes sends the session cookie and an anonymous preconnect would
  warm the wrong connection pool.
- **The board asks for the board.** `listReviews` takes an optional status and
  cap; unfiltered it gets the API's own default, which is the active reviews
  rather than every review the deployment has ever tracked.
