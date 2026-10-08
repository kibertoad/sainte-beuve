import type { HttpBindings } from '@hono/node-server'
import { ConfigurationError } from '@sainte-beuve/kernel'
import type { RequestScope } from '@sainte-beuve/server'

/** RFC 9110 `token`, which is every header name there is. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/

/**
 * `CLIENT_ADDRESS_HEADER`: the header the reverse proxy in front of this
 * process writes the client's address into, lower-cased. Blank is none.
 *
 * A name that is not a header name throws, because the alternative is a
 * deployment that believes its proxy is read and keys every caller on it.
 */
export function clientAddressHeaderFrom(value: string | undefined): string | null {
  const name = (value ?? '').trim().toLowerCase()
  if (name.length === 0) return null
  if (!HEADER_NAME.test(name)) {
    throw new ConfigurationError(
      `CLIENT_ADDRESS_HEADER is "${value}", which is not a header name. Name the header your ` +
        'proxy writes the client address into (`x-forwarded-for`, `x-real-ip`), or clear it.',
    )
  }
  return name
}

/**
 * Who the request came from, as the throttle on failed API keys counts it.
 *
 * Without a header that is the socket's peer, which behind a reverse proxy is
 * the proxy, so every caller there shares one bucket. With one, it is the LAST
 * entry of that header: the one the proxy next to this process appended, and so
 * the only one a client cannot write. A request without the header did not come
 * through the proxy, and its socket peer is the client.
 */
export function clientAddressOf(header: string | null): (scope: RequestScope) => string | null {
  return (scope) => {
    const forwarded = header === null ? null : lastEntry(scope.req.headers.get(header))
    return (
      forwarded ?? (scope.env as HttpBindings | undefined)?.incoming?.socket.remoteAddress ?? null
    )
  }
}

function lastEntry(value: string | null): string | null {
  const last = value?.split(',').at(-1)?.trim()
  return last === undefined || last.length === 0 ? null : last
}
