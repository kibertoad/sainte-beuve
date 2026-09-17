---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/app': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
---

Know who is calling: sessions for people, API keys for machines.

Everything below `/api/v1` now resolves a principal. A person signs in through
GitHub or GitLab and is carried by an `HttpOnly` session cookie; a machine
presents `Authorization: Bearer sbk_…`. The workspace stops rendering for
whoever the deployment's source-control credential acts as and renders for
whoever is SIGNED IN, which is the substitution a shared deployment needed.
See `docs/auth.md`.

- `AUTH_MODE` decides whether an anonymous caller is refused, and it is typed
  rather than derived: inferring `required` from "an OAuth client exists" locks a
  laptop out of its own board, and inferring `open` from "nothing is configured"
  leaves a hosted deployment open on a typo. It defaults to `open`, which is what
  every deployment ran before this and what local mode still runs, and `/health`
  reports the mode beside the hosts a sign-in could actually use.
- A session is 32 random bytes and a row keyed on their unkeyed SHA-256 digest.
  Not a JWT: the two things this has to do (sign somebody out, drop every session
  of a reviewer) are revocations, which a self-describing token cannot serve.
  Expiry is absolute, `lastSeenAt` is written at most every five minutes, and the
  reminder tick sweeps what has run out — on both runtimes, from the one periodic
  pass they share.
- An API key is deliberately NOT a person. It has no reviewer row, so the routes
  that render for a viewer refuse it by name rather than inventing somebody: the
  same answer a GitHub App installation already got. Keys are minted on the
  Configuration screen, shown once and stored as digests; `AUTH_API_KEY` is the
  deployment's own, matched before the store, and answers the bootstrap for a
  `required` deployment that has no sessions yet.
- The sign-in split in two over one OAuth client and one callback: the
  Configuration screen's button connects the DEPLOYMENT's credential, the new one
  proves who the caller is and stores nothing. One button doing both meant every
  person who signed in overwrote the credential the board runs on. Both establish
  a session, because both proved the same thing.
- `sessions` and `api_keys` land in all three stores with a case apiece in
  `@sainte-beuve/persistence-conformance`, a D1 migration and a generated Postgres
  one. Neither carries a payload column: every field is read, and what must not be
  readable is a digest.
- Minting a key is the one route an `open` deployment still refuses an anonymous
  caller: it is the only thing here that outlives the mode, so a key minted a
  minute before `AUTH_MODE=required` would go on answering after it. `AUTH_API_KEY`
  is matched before the `sbk_` prefix check as well as before the store, so it is
  whatever value an operator's secret manager produced.
- The round-trip state is bound to the browser that started the flow. Signed and
  recent is not enough on its own: anybody may start a flow and be handed a state
  this deployment really signed, and handing the finished callback URL to somebody
  else would sign THEM in on the attacker's account. A nonce rides in the state and
  in a short-lived `HttpOnly` cookie, and the callback accepts only a matching pair.
- CORS became load-bearing, because a browser sends a cookie only to an origin the
  response NAMES, the credentials header is invalid beside `*`, and a browser
  refuses a `*` answer outright on any request that asked to send a credential —
  which the SPA's client does on every call. A hosted deployment's SPA origin
  therefore has to be one it named, through `CORS_ORIGINS` or through
  `APP_BASE_URL`, whose origin every runtime facade folds into the list. Loopback
  is echoed by name even under the wildcard when the deployment is itself loopback,
  which is what keeps local development working.
- CORS is not the whole of it, so every unsafe method under `/api/v1` now goes
  through an `Origin` check: a cross-site `text/plain` POST is a simple request,
  carries the session cookie on a `SameSite=None` deployment, and is only denied
  its ANSWER by CORS — after the write has run. `Secure` on the session cookie and
  the same-origin comparison both read `X-Forwarded-Proto`/`X-Forwarded-Host`, so a
  deployment behind a TLS terminator neither issues a cookie in the clear nor
  refuses its own SPA.
- The Access card renders above the credential cards rather than inside them, and
  takes `null` for keys it could not read. It holds the only sign-in button there
  is, and the routes beside it are exactly the ones a `required` deployment refuses
  to anybody anonymous — so gating it on their success made the documented way in
  unreachable in the one mode it exists for.
