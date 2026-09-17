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
read it, so nothing in the page can. "On https" is read from `X-Forwarded-Proto`
first and from the request's own scheme only after: a single-host deployment
behind nginx receives `http://` on every request however the browser reached it,
and the scheme alone would drop `Secure` from the one cookie that must never
travel in the clear. When an origin the deployment NAMED is on a different
HOSTNAME from the one the browser addressed, it becomes `SameSite=None; Secure`
instead, because `Lax` is not sent on a cross-site fetch and the sign-in would
otherwise complete and never stick. Every named origin counts, not `APP_BASE_URL`
alone: a split-host deployment that listed its SPA in `CORS_ORIGINS` and nothing
else has stated the same fact, and answering `Lax` there is a sign-in that fails
on the callback and blames the operator's browser for it.

The hostname it is compared against is the one the browser addressed — the same
`X-Forwarded-Host` reading the same-origin check makes — so a single-host
deployment behind a proxy that rewrites `Host` does not call itself cross-site
and throw away the protection `Lax` was giving it. The comparison is on the
hostname rather than the registrable domain, which over-applies `None` to a
deployment split across two subdomains of one domain; `None` still works there,
and a missed cross-site case is a sign-in that silently does nothing.

**CORS matters here**, and more than it first looks. A browser sends a cookie
cross-origin only to an origin the response NAMES, `Access-Control-Allow-Credentials`
is invalid beside `*`, and a browser refuses a `*` answer **outright** on any
request that asked to send a credential. The SPA's client asks on every call, so
a hosted deployment whose SPA origin is not named does not serve reads and fail
at sign-in: it serves nothing.

So the SPA origin has to be one the deployment named — through `CORS_ORIGINS`, or
through `APP_BASE_URL`, whose origin is folded into the list by every runtime
facade. That second path is not a duplicate spelling of the first: the deployment
already had to say where its SPA is for the sign-in's return leg, and a variable
that states a fact should not have to state it twice.

Loopback is echoed by name even under the wildcard — but only when the deployment
is **itself** loopback, which is what makes local development work and is the
whole of the exception. Against a hosted deployment, a page on
`http://localhost:<port>` is some other program on the operator's machine (a dev
server, an installed app, a package's postinstall), and naming it would hand that
program the credentials header and, with it, the operator's session on the
Configuration screen. An operator who really does run the SPA locally against a
hosted API lists that origin like any other.

### Requests from another origin

CORS decides what a browser may **read**. It does not decide what runs. A
cross-site `POST` with a `text/plain` body is a _simple_ request: no preflight is
sent, the session cookie rides along on a `SameSite=None` deployment, and all
CORS withholds is the response — by which time the write has happened.

Everything under `/api/v1` that the wildcard does not cover therefore goes
through an `Origin` check before anything else: the origin has to be the one the
browser addressed (same-origin), or one the deployment named. That is the same
list CORS reads — every unsafe method, the configuration routes, and the
AI-review routes — rather than unsafe methods alone, because a GET is not always
a read: answering one under `/ai-review` polls cat-factory with this deployment's
key and writes what it learns onto the run, and hiding that answer from a
cross-site page leaves the spend already made. A caller that sends no `Origin` is
not a browser — a CI job on an API key, or an inbound webhook, which carries its
own signature — and passes; so does a preflight, which the CORS layer above
answers on its own. Same-origin is compared against `X-Forwarded-Host` and
`X-Forwarded-Proto` where they are set, so a deployment behind a terminator does
not refuse its own SPA over a scheme it never sees.

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

### The state is bound to the browser that started the flow

Signed and recent is not enough on its own. Anybody may start a flow here and be
handed a state this deployment really signed; handing the finished callback URL
to somebody else would sign **them** in on the attacker's account — login CSRF —
and on the `connect` flow would store the attacker's credential as the
deployment's.

So the state carries a `nonce`, and the answer that hands out the authorize URL
sets the same value in a short-lived `HttpOnly` cookie with the session cookie's
attributes. The callback accepts the round trip only where the two match, spends
the cookie, and clears it either way. Producing a matching pair means holding
both halves, which is what a second browser does not.

A deployment where that cookie cannot be stored is one where the session cookie
could not have been stored either, so this refuses nothing that would otherwise
have worked.

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

Minting is also the **one** route an `open` deployment still refuses an anonymous
caller. `open` means the deployment refuses nobody, and that holds for every route
whose effect is bounded by the mode: whoever can empty the project registry today
is whoever can reach the deployment today, and `AUTH_MODE=required` takes it back
tomorrow. A minted key does not come back — it is a durable bearer credential that
keeps answering after the switch — so the route that produces one asks who is
calling even where nothing else does. Listing and revoking are not guarded:
neither creates anything that outlives the mode, and guarding the read would take
the Configuration screen away from the laptop the open default exists for.

Beside them there is `AUTH_API_KEY`, the deployment's OWN key, read from the
environment. It answers the bootstrap — a `required` deployment has no sessions
and no minted keys, so the route that mints the first key would be the route
nobody can reach, and an `open` one has the same problem now that minting asks
who is calling. It is matched before the store, so it keeps working while the
database is being restored, and before the `sbk_` prefix check, so it is
whatever value an operator's secret manager produced rather than something they
had to spell a particular way. It cannot be revoked through the API, and the
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
