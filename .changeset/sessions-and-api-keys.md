---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/persistence-d1': minor
'@sainte-beuve/persistence-postgres': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/app': minor
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
- CORS became load-bearing, because a browser sends a cookie only to an origin the
  response NAMES and the credentials header is invalid beside `*`. A hosted
  deployment has to list its SPA in `CORS_ORIGINS`; loopback is now echoed by name
  even under the wildcard, which is what keeps local development working.
