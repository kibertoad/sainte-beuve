import { isWebUrl } from '@sainte-beuve/contracts'

// Every link the API hands back is rendered as an `href`, and Vue binds one
// verbatim: a `javascript:` URL in a review row would run in the tab of whoever
// clicked it, with their session. The contracts refuse such a URL on the way in,
// and the durable stores and this client's response check refuse it on the way
// out. This is the check at the anchor itself, so a link is safe however it got
// to the screen.

/** The link if it is `http(s)`, otherwise nothing, so the anchor renders without one. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) return undefined
  return isWebUrl(url) ? url : undefined
}
