---
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/app': minor
---

Close L4 and L10 of the security review.

- L4: `AUTH_API_KEY` is read through `environmentApiKeyFrom` on every runtime,
  and a value shorter than 32 characters, or one starting with the minted `sbk_`
  prefix, is a configuration error: Node refuses to start and a Worker answers
  every request 503 naming the variable. A client that presents 20 wrong values
  for that key within ten minutes is answered 429 (`rate_limited`, with
  `Retry-After`) before its next one is compared; minted keys and sessions are
  never counted or refused. `createApp` takes a `clientAddress` callback to key
  that count: `CF-Connecting-IP` on a Worker, and on Node the socket's peer or
  the header a reverse proxy writes, named by the new `CLIENT_ADDRESS_HEADER`.
  An IPv6 client is counted by its /48, and a burst sent at once is held to the
  same ceiling as a sequence.
- L10: every API response carries `secureHeaders()` with a
  `default-src 'none'; frame-ancestors 'none'` policy, `X-Frame-Options: DENY`
  and `Referrer-Policy: no-referrer`, and `/api/v1` answers
  `Cache-Control: no-store` unless a route set its own. Every page the SPA layer generates
  carries a Content-Security-Policy that allows its inline scripts by hash and
  nothing else inline, so a `javascript:` URL in a rendered link does not run.

Breaking: a deployment whose `AUTH_API_KEY` is shorter than 32 characters, or
starts with `sbk_`, no longer starts. Generate one with `openssl rand -hex 32`.
