/**
 * What a browser actually addressed, on a deployment with a proxy in front of it.
 *
 * A TLS terminator hands this process a plain `http://` request against an
 * internal host, so `c.req.url` answers a different question from the one two
 * places here have to ask: which scheme did the BROWSER speak (which decides
 * whether the session cookie is `Secure`), and which origin does it believe it
 * is talking to (which decides whether a write is same-origin). Reading the
 * forwarded headers is what closes that gap, and it is worth one module because
 * getting it right in one place and wrong in the other is the failure mode.
 *
 * The headers are set by whoever is calling, so they are believed only where a
 * forgery costs the forger and nobody else. Both callers below are in that
 * shape: a forged `https` gives the caller a cookie their own next plain request
 * will not carry, and a forged host makes their own write look cross-site.
 */

/** The first entry of a header a chain of proxies may have appended to. */
function firstValue(header: string | undefined): string | null {
  const first = header?.split(',')[0]?.trim()
  return first === undefined || first.length === 0 ? null : first
}

/** Enough of a request for either reading below. Structural, so a Hono context fits. */
export interface ForwardedRequest {
  req: { url: string; header: (name: string) => string | undefined }
}

/** The scheme the browser spoke, when something in front said so. */
export function forwardedProto(c: ForwardedRequest): 'http' | 'https' | null {
  const value = firstValue(c.req.header('x-forwarded-proto'))?.toLowerCase()
  return value === 'http' || value === 'https' ? value : null
}

/**
 * The origin the browser believes it is talking to.
 *
 * Both halves fall back to the request's own URL, which is what a deployment
 * with nothing in front of it has and is also the local case.
 */
export function requestOrigin(c: ForwardedRequest): string {
  const url = new URL(c.req.url)
  const proto = forwardedProto(c) ?? url.protocol.replace(':', '')
  return `${proto}://${firstValue(c.req.header('x-forwarded-host')) ?? url.host}`
}

/**
 * The HOSTNAME the browser addressed, which is the half of the origin that
 * decides whether a cookie is cross-site: `SameSite` is a rule about sites, so
 * the scheme and the port are not part of the question.
 *
 * Falls back to this process's own URL when what was forwarded does not parse,
 * because a header somebody in front set badly is not a reason to fail a
 * sign-in — it is a reason to answer what we can see ourselves.
 */
export function requestHostname(c: ForwardedRequest): string {
  try {
    return new URL(requestOrigin(c)).hostname
  } catch {
    return new URL(c.req.url).hostname
  }
}
