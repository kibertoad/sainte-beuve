# The org boundary

[docs/auth.md](./auth.md) closed the first half of slice 6: every request under
`/api/v1` knows WHO is calling. This is the second half — what they may reach,
and what they may change. It is the last thing between a deployment one team runs
and a deployment several teams share.

Two ideas, and the first is deliberately not an idea at all.

## An org is a column

Every row in the store belongs to exactly one org. Not a filter somebody
remembers to apply, not a predicate a service passes down: a column, in the
primary key, on all eleven tables.

```
  credential ──▶ orgId ──▶ stores.forOrg(orgId) ──▶ the eleven repositories
  (cookie, key)                                     a service actually sees
```

The authentication middleware resolves the caller, reads the org off their
credential, and rebinds the container to it. Everything below that line —
`WorkspaceService`, `ReviewService`, `AttentionService`, every controller — asks
`container.repositories` for a store exactly as it did before orgs existed, and
what it gets **cannot see another tenancy**. No service takes an org, no route
accepts one, and there is therefore no call site that can forget to pass one.

That is the whole design, and it is the reason it is worth writing down. The
obvious alternative — `listDue(orgId, now, limit)`, `getById(orgId, id)` — makes
the boundary a rule every one of about seventy call sites has to obey, and a rule
obeyed sixty-nine times is not a boundary. Binding it at the store makes leaking
impossible rather than merely discouraged.

The three implementations reach it differently. The in-memory store hands each
org its own maps, so there is no predicate to get wrong; D1 and Postgres put
`org_id` in every statement and in every primary key, so a query that dropped it
does not read somebody else's rows — it fails to parse.
`@sainte-beuve/persistence-conformance` is what says the two arrangements mean
the same: `tenancyConformanceCases` writes the SAME ids into two orgs and reads
each back, three ways.

### The three reads that are not inside an org

Something has to decide which org a request is in, and it cannot itself be
scoped. `TenancyDirectory` is that surface and it is exactly three methods:

| Method                | Asked by                                  | Answers                                |
| --------------------- | ----------------------------------------- | -------------------------------------- |
| `findSessionByDigest` | every authenticated request with a cookie | the session, and its org               |
| `findApiKeyByDigest`  | every request with a bearer key           | the key, its org and its role          |
| `findOrgIdForProject` | an inbound GitHub delivery                | the org that registered the repository |

Nothing there reads a board, a directory or a registry, and that list is short
enough to audit. The digests are UNIQUE across every org for the same reason they
are unique at all: two rows for one value would make which board a cookie opens
depend on which row the planner reached first.

### The default org

`org_default` is a fixed id, and it is what makes this land without a data
migration anybody has to run. Every row written before the boundary existed is
backfilled to it, and every caller a deployment cannot place — anonymous on an
`open` deployment, or holding `AUTH_API_KEY` — is placed in it. **A deployment
that never makes a second org is entirely inside it and behaves exactly as it
did.**

Its ROW is synthesised rather than written. A deployment that never made a second
org has an empty `orgs` table and a full board, and writing the row on first read
would make `GET /api/v1/auth/session` — the route every page polls — a write, on
a store that may be read-only while a restore is running.

### Choosing one

There is exactly one moment an org is chosen by something a caller sent:

```
GET /api/v1/auth/sign-in/github?org=acme
```

`default` is accepted whether or not the default org's row exists, because it is
the slug every caller can read off their own auth state and the one slug nobody
is allowed to create. The slug goes into the SIGNED state, the callback reads it
back, and the session it establishes is bound to it for good. A slug in the callback URL instead would
let anybody who can hand somebody a link decide which tenancy they land in. A
slug nobody has made is a 404 rather than a quiet fall back to the default org,
because somebody who typed an org name and was signed in to a different board
would have no way to tell afterwards.

Naming an org is not joining one. Whether the account that comes back may become
a person in it is a separate decision; see below.

### The one thing `forOrg` could not scope

The attention bus is a single object per PROCESS — it has to be, because a
Worker rebuilds its container per request and a bus built with it would have one
subscriber and no publisher. So it is the one thing on the container that cannot
be handed out as a scoped copy, and the only place the boundary had to be closed
by hand.

The org is therefore a parameter of the BUS (`publish(orgId, event)`,
`subscribe(orgId, listener)`) and never of its callers: `withOrg` binds a
`ScopedAttentionBus` beside the repositories, and `AttentionService` and the SSE
controller pass no org at all.

Getting this wrong is quiet and complete. A live event is filtered by `reaches`
→ `isInAttentionAudience`, which knows about skills and teams and nothing about
orgs — and an ask with no required skills and no same-team gate concerns _any_
available reviewer. One process serving two tenancies would push every ask in the
first onto the open streams of the second. The REST inbox was never affected,
because it reads through the org-bound repositories like everything else.

## A role is what you may change

Two roles, because the gap slice 6a left was exactly one distinction: "can revoke
an API key" and "can read the board" were the same permission.

|                                                         | admin | member |
| ------------------------------------------------------- | ----- | ------ |
| The board, the workspace, attention, AI reviews         | ✔     | ✔      |
| Reading the reviewer directory and the project registry | ✔     | ✔      |
| Integration credentials, sign-in connections            | ✔     |        |
| API keys: listing, minting, revoking                    | ✔     |        |
| The reviewer directory: adding, editing, pausing        | ✔     |        |
| The project registry: registering, removing             | ✔     |        |
| Orgs: listing, creating                                 | ✔     |        |

An **admin configures the deployment; a member uses it.** Anything finer is a
permission matrix, and a matrix nobody has asked for yet is a matrix that will be
wrong.

The role lives on the reviewer row, because the reviewer row IS the membership: a
person exists in exactly one org's directory, and a second table would be a
second row to keep in step for one fact. It is read per request on the four
routes that consult it rather than carried on the session, so a demotion takes
effect at once instead of whenever somebody next signs in.

A KEY carries its own role instead, on the row, chosen at mint time and never
afterwards. A key outlives whoever made it, so inheriting the minter's role is
how a build script comes to be able to revoke the credentials it runs on.

### Anonymous is an admin

On an `open` deployment, a caller nobody can name is an admin of the default org.
That is a decision, not an oversight: `open` means this deployment refuses
nobody, so whoever can reach it can already reach every route. Answering `member`
would take the Configuration screen away from the laptop the open default exists
for while changing nothing about who can get at it. Closing the door is
`AUTH_MODE=required`, and it closes this too.

### Joining is a decision somebody makes

A finished OAuth round trip proves that somebody has an account on a host. It
proves nothing about whether they belong here: on github.com and gitlab.com any
account can authorise any OAuth app, the client id is public by construction, and
`/health` advertises which hosts a deployment offers. So membership is a decision,
carried on the org as `enrolment`:

| `enrolment` | who may join                                                 |
| ----------- | ------------------------------------------------------------ |
| `invite`    | an account whose handle an admin registered in the directory |
| `open`      | any account the host will authorise, as a member             |

**`invite` is the default**, including for the default org and for a row written
before the field existed: an org nobody decided about is closed. `open` is what
every org did before the flag, and it is a deployment saying that its OAuth client
is scoped to its own people. An admin moves their own org either way with
`PATCH /api/v1/settings/orgs/current`.

Enrolment is asked once, when an account first becomes a person here. An account
already linked to a directory row keeps signing in after the door closes, because
closing it is about who may JOIN; taking somebody's access away is
`availability: paused`, below.

Two paths are deliberately outside it. The **connect** round trip
(`/api/v1/settings/connections/...`) is admin-only, so somebody with authority
over the org caused that account to appear. And the `open`-mode viewer, where the
deployment's own source-control credential acts as a person, is the operator's own
token. Neither is a stranger arriving with a link.

### The first person in is the admin, and only the first

An org is created by an operator who does not thereby become a person in it, so
the first sign-in to an org with an EMPTY directory becomes its **admin**. There
is no other honest rule for an org nobody is in: a first member who could not
configure the tenancy would leave an org with a board, a directory and a
Configuration screen nobody on the deployment could open, and no route that could
fix it, because promoting somebody is itself an admin's act.

That founding sign-in is a race with whoever else knows the slug, which is why
`POST /api/v1/settings/orgs` takes a **founder**:

```json
{ "slug": "acme", "name": "Acme", "founder": { "provider": "github", "handle": "ada" } }
```

The org then has an admin row before anybody is told the slug, the directory is
not empty, and nobody else can found it.

**A registered handle does not confer `admin` twice.** A handle is a string an
admin typed; a subject is the host's own id for an account. A row registered by
hand is therefore a claim waiting to be taken, and adoption hands it `admin` only
while no admin of the org has actually signed in — which is exactly the founder's
window. After that a pre-registered `admin` row is adopted as a `member`, and an
admin who can now see WHICH account took it promotes them. Without that, a typo, a
released-and-re-registered login, or simply the wrong Bob inherits the role
permanently, because the `(provider, subject)` link is then the wrong subject.

Adoption also skips any row an account has already proved itself against: without
that, whoever holds the GitHub login `bob` takes the row of the Bob who signed in
through GitLab a year ago, along with his workspace, his commitments and his role.

The whole decision is one pure function, `decideEnrolment` in
`@sainte-beuve/reviewers`, over four facts: the org's enrolment, the size of the
directory, the role on the row the handle matched, and whether any admin has
signed in. `PeopleService` reads those facts and writes the answer down.

## Pausing somebody signs them out

`deleteForReviewer` existed on the session port from the day sessions did and
nothing called it, because what pausing should mean for ACCESS — as opposed to
for selection — was a question slice 6a did not answer.

This is the answer. `paused` is the only way out of the directory (there is no
delete, on purpose: the row is what a review's assignment and a linked host
account point at), so it is the only thing this deployment has that means "not
them, for now", and a state that left a live cookie behind would mean it never
meant that at all.

A DEMOTION deliberately does not, because it does not have to: the role is read
off the reviewer row, so it takes effect at once, and signing somebody out of a
board they may still read would be a second thing happening for no reason.

## Upgrading into it

Two migrations, one per dialect, and neither needs a step anybody runs by hand:

- **D1** (`persistence-d1/migrations/0003_orgs.sql`) rebuilds each table, because
  SQLite cannot alter a primary key. The rebuild is also what makes the backfill
  exact: one `INSERT ... SELECT 'org_default', ...` per table rather than a
  nullable column somebody has to remember to fill.
- **Postgres** (`20260917131337_jazzy_young_avengers`) is generated by
  drizzle-kit and then edited in three places: every `org_id` is added nullable,
  backfilled, and only then made `NOT NULL`, and the two role backfills below.

**Rows that already existed become admins**, both reviewers and API keys. A row
written before roles existed belongs to somebody who could already reach every
route on the deployment, so narrowing it would upgrade a working deployment into
one whose Configuration screen nobody can open, or break whatever CI job is
calling with that key.

## What this does not do yet

**A Slack command acts on the default org.** A GitHub delivery names a
repository, and the project registry says which tenancy claimed it; a slash
command names a Slack user and a channel, and nothing on this deployment maps
either to an org — the signing secret is deployment wiring rather than an org's
credential, so one Slack app serves every tenancy. Searching every org's
directory for the Slack id would be a read across the boundary on an
unauthenticated path, and would answer ambiguously for anybody who is in two. A
deployment with a second org reaches it through the SPA and through GitHub.
Closing this needs an org's own Slack connection, which is a credential change
rather than a routing one.

**An inbound delivery for a repository nobody registered lands in the default
org.** Registering it is the answer, and on a single-tenant deployment the
default org is where everything already is.

**An org cannot be removed.** It owns rows in all eleven other tables, so
removing one is a cascade across the whole store and a question — what happens to
the board, to the sessions, to the sealed credentials — that nobody has asked
yet. Until they do, an org that is finished with is an org nobody signs in to.

**An invitation is a directory row, not a link.** An admin registers somebody by
handle and that person takes the row at their first sign-in. There is no
invitation token, no expiry and no way to invite an account that is not on a host
this deployment can sign in with. What there IS is the refusal: an account nobody
registered is answered 403 naming the remedy, rather than becoming a member.

**A repository belongs to whichever org registered it first**, and a second org
is now refused rather than silently losing the claim. An inbound delivery carries
no credential of ours, so the registry is the only thing that can place it;
verifying at registration that the org can actually reach the repository is the
next step, and needs the org's credential rather than a table lookup.
