import { ConfigurationError, UnavailableError } from '@sainte-beuve/kernel'
import type { AppContainer } from '../container.js'
import { isLoopback } from '../config/authMode.js'

/**
 * The origin an OAuth callback is built on: where the host sends the browser
 * back with a code, and the `redirect_uri` the code is then exchanged under.
 *
 * FROM CONFIGURATION, NOT FROM THE REQUEST. `c.req.url` on Node is built from
 * the `Host` header, which the caller writes. GitHub matches a `redirect_uri` on
 * the registered host INCLUDING its subdomains, so a caller who controls any
 * subdomain of the API's host (or reaches a Node process whose proxy forwards
 * any `Host`) could start a flow whose callback lands on their own server,
 * hand the authorize URL to a victim, and finish the round trip with the code
 * themselves. On the `connect` purpose the victim's token would become the org's
 * credential. `API_BASE_URL` closes that, and it is also the only reading that
 * is right behind a TLS terminator, where the request this process sees is
 * plain `http`.
 *
 * Without it the request's own origin is accepted on a LOOPBACK host only. That
 * keeps a laptop working with nothing set, and it is safe for the reason the
 * finding was not: a forged `Host: localhost` sends the code to the victim's own
 * machine, which nobody else can read.
 */
export function callbackOrigin(container: AppContainer, requestUrl: string): string {
  if (container.apiBaseUrl !== null) return configuredOrigin(container.apiBaseUrl)
  const request = new URL(requestUrl)
  if (isLoopback(request.hostname)) return request.origin
  throw new UnavailableError(NO_API_BASE_URL)
}

function configuredOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigurationError(`API_BASE_URL is not a URL: "${value}".`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigurationError(`API_BASE_URL is an http or https URL, not "${value}".`)
  }
  // An origin and nothing else. The callback is `<origin>/connect/<host>/callback`,
  // so a path here would be dropped without a word, and the redirect URI the host
  // is sent would not be the one the operator registered.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new ConfigurationError(
      `API_BASE_URL is an origin with no path, such as https://api.example.com, not "${value}".`,
    )
  }
  return url.origin
}

const NO_API_BASE_URL =
  'Signing in needs to know where this API is served from, so the callback a host sends the ' +
  'browser back to cannot be chosen by whoever sent the request: set API_BASE_URL to the ' +
  "API's public origin, such as https://api.sainte-beuve.example.com."
