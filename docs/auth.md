# Who is calling

Everything below `/api/v1` now knows who asked. This is the first half of slice 6
in [the implementation plan](./implementation-plan.md): sessions for people, API
keys for machines, and one guard over both. The org boundary — a tenancy around
the reviewer pool and the board — is the half still outstanding, and is called
out at the end.

## Two kinds of caller

A **person** arrives in a browser, proves who they are on GitHub or GitLab, and
is carried afterwards by a session cookie. A **machine** arrives from CI or a
script and presents a key in `Authorization: Bearer <key>`.

They are not interchangeable, and the difference is load-bearing rather than
tidy. A session names a REVIEWER ROW, so it has a workspace: the three lists, an
attention inbox, commitments. A key names nobody, so the routes that render for a
viewer refuse it with a message saying so — the same answer a GitHub App
installation already got, for the same reason. Guessing a person for a CI job
would put somebody else's work on its screen.

```
                       cookie: sb_session          Authorization: Bearer sbk_…
                                │                              │
                        ┌───────▼────────┐             ┌───────▼────────┐
                        │ sessions       │             │ api_keys       │
                        │ (digest → row) │             │ (digest → row) │
                        └───────┬────────┘             └───────┬────────┘
                                │                              │
                                └──────────┬───────────────────┘
                                           ▼
                                    RequestPrincipal
                     anonymous  |  session(reviewer)  |  api_key(label)
```

## Open, or required

`AUTH_MODE` decides, and it is a decision somebody types rather than something
derived from the rest of the configuration:

- **`open`** (the default) refuses nobody. It is what every deployment ran before
  sessions existed and what local mode still runs: the workspace renders for
  whoever the deployment's own source-control credential acts as, which is right
  for one person's laptop and wrong for anything shared.
- **`required`** refuses an anonymous call to everything under `/api/v1` except
  `/api/v1/auth/*`, and the workspace then renders for whoever is SIGNED IN.

Both derivations of the mode fail in the direction that hurts. Deriving
`required` from "an OAuth client exists" locks a laptop out of its own board the
day somebody configures a sign-in; deriving `open` from "nothing is configured"
leaves a hosted deployment open because a variable was mistyped. So it is typed,
and `/health` reports what took effect beside the hosts a sign-in could use:

```json
{ "auth": { "mode": "required", "signInProviders": ["github"], "environmentApiKey": true } }
```

`mode: "required"` with an empty `signInProviders` and no environment key is a
deployment nobody can enter, including the operator who set the variable. That is
the state the probe exists to make visible.

## Sessions

A session is 32 random bytes in an `HttpOnly` cookie and a row keyed on their
SHA-256 digest. There is no JWT and no signed cookie, and that is the decision
worth recording: a self-describing token cannot be revoked, and the two things
this has to do — sign somebody out, and drop every session of a reviewer who was
paused or merged away — are both revocations. The price is one indexed read per
request, against a store the request was going to touch anyway.

The digest is **unkeyed**. At 256 bits of randomness there is nothing to guess
and no dictionary to run, so hashing under the deployment's master key would buy
nothing and cost something real: every live session would stop resolving on a key
rotation, and a rotation is routine rather than an incident.

Expiry is **absolute** (30 days by default, `AUTH_SESSION_LIFETIME_MS`). A
sliding window would never end for the one caller that matters here, a script
holding a cookie scraped out of a browser profile. A session read past its expiry
is refused AND deleted on the way past; what is left over is swept by the
reminder tick, which is the one periodic pass both runtimes already have.

`lastSeenAt` is written at most every five minutes. Without that, every
authenticated request is a billed row-write on D1 and a row lock on Postgres, for
a field an operator reads in days.

### The cookie

`HttpOnly; Path=/; SameSite=Lax`, `Secure` on https. Nothing in the page needs to
read it, so nothing in the page can. When the deployment's `APP_BASE_URL` is on a
different HOSTNAME from the API, it becomes `SameSite=None; Secure` instead,
because `Lax` is not sent on a cross-site fetch and the sign-in would otherwise
complete and never stick. The comparison is on the hostname rather than the
registrable domain, which over-applies `None` to a deployment split across two
subdomains of one domain; `None` still works there, and a missed cross-site case
is a sign-in that silently does nothing.

**CORS matters here.** A browser sends a cookie cross-origin only to an origin the
response NAMES, and `Access-Control-Allow-Credentials` is invalid beside `*`. So a
hosted deployment has to list its SPA in `CORS_ORIGINS`; one left on the wildcard
serves reads and can never carry a session. Loopback is the exception and is
echoed by name even under the wildcard, which is what makes local development
work.

## Signing in

Two flows over one OAuth client and one callback path, told apart by the signed
state they carry:

| Started from                          | Flow      | Stores the deployment credential | Establishes a session |
| ------------------------------------- | --------- | -------------------------------- | --------------------- |
| Configuration → "Sign in with GitHub" | `connect` | yes                              | yes                   |
| Access card → "Sign in with GitHub"   | `session` | no                               | yes                   |

One button doing both would mean everybody who signed in overwrote the
repository-write credential the board runs on. Both establish a session, because
both proved the same thing: an operator who just connected a credential has
demonstrated exactly what a sign-in demonstrates.

On a `required` deployment the order matters once: the Configuration screen's
connect flow is under `/api/v1/settings` and is therefore behind the guard, while
`/api/v1/auth/sign-in/<host>` is not. So the first person in signs in, and
connects the deployment's credential afterwards — or reaches the settings routes
with `AUTH_API_KEY` if there is no OAuth client to sign in with at all.

The person behind the account is resolved by `PeopleService`, which is the same
claim rule the viewer read uses: an existing directory row with that handle is
ADOPTED rather than forked, and the `(provider, subject)` key decides the winner
when three page loads race. A second copy of that rule is how a directory comes to
hold two people for one human being.

## API keys

Minted on the Configuration screen, shown once, stored as a digest with a label
and the last four characters. `POST /api/v1/settings/api-keys` is the only route
in the API whose response carries a secret.

They live under `/settings` with the credential routes on purpose: minting one
produces a credential, and that prefix is what the wildcard CORS default already
stops at.

Beside them there is `AUTH_API_KEY`, the deployment's OWN key, read from the
environment. It answers the bootstrap — a `required` deployment has no sessions
and no minted keys, so the route that mints the first key would be the route
nobody can reach — and it is matched before the store, so it keeps working while
the database is being restored. It cannot be revoked through the API, and the
refusal says to clear the variable rather than answering "no such key".

## What this does not do yet

**There is no org boundary.** A session says WHO is calling; nothing yet says what
they may reach. Every authenticated caller sees the same board, the same reviewer
directory and the same project registry, and every key is as powerful as every
other. That is the second half of slice 6, and it touches every table: a tenancy
column in three stores, a migration per dialect, and a scope on every port.

**Roles are the same gap, one level down.** "Can revoke an API key" and "can read
the board" are the same permission today.

**A session does not follow a paused reviewer.** `deleteForReviewer` exists on the
port and nothing calls it yet; pausing somebody in the directory leaves their
cookie working. It is a line in `ReviewerService` once there is a policy about
what pausing should mean for access, rather than only for selection.
