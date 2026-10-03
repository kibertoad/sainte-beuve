import { isWebUrl } from '@sainte-beuve/contracts'

// Every link the API hands back is rendered as an `href`, and Vue binds one
// verbatim: a `javascript:` URL in a review row would run in the tab of whoever
// clicked it, with their session. The contracts refuse such a URL on the way in;
// this is the half that does not trust a row written before they did, or a store
// nobody validated on the way out.

/** The link if it is `http(s)`, otherwise nothing, so the anchor renders without one. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) return undefined
  return isWebUrl(url) ? url : undefined
}
