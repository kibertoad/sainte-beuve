// ---------------------------------------------------------------------------
// The SPA's own paths, as constants.
//
// These are not api contracts and not inbound webhooks: they are the screens a
// MESSAGE links back to. A reminder in Slack and a comment on a pull request
// both carry "and here is where to deal with it", and the URL in them is built
// on a backend that cannot see the router the frontend ships. Hand-written, that
// is a string nobody type-checks and nobody renames: every reminder this
// deployment has ever sent pointed at `/reviews/<id>`, a route the SPA has never
// had, so the one message that says the answer is NOT on the pull request was
// the one message that led to a 404.
//
// So the path lives here, beside the route contracts, and both halves import it:
// the Slack message builds it, and the board reads the query it names.
// ---------------------------------------------------------------------------

/** The review board. */
export const BOARD_PATH = '/board'

/**
 * Which row the board should open on, as a query parameter rather than a path
 * segment.
 *
 * A query, because the board is one screen: a row is expanded in place, not
 * navigated to, and a `/board/<id>` route would be a second page rendering the
 * same list to show one card of it. It also degrades honestly — a deployment
 * whose board no longer carries that review still lands somebody on the board.
 */
export const BOARD_REVIEW_QUERY = 'review'

/** Where a message sends somebody to deal with one review. */
export function boardReviewPath(reviewId: string): string {
  return `${BOARD_PATH}?${BOARD_REVIEW_QUERY}=${encodeURIComponent(reviewId)}`
}

/** The same, absolute, for a deployment that knows its own base URL. */
export function boardReviewUrl(appBaseUrl: string, reviewId: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${boardReviewPath(reviewId)}`
}
