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

The org boundary: a tenancy on every table, and roles over it.

A session said who was calling; nothing said what they could reach. Every row now
belongs to an org, the repositories a request reaches are bound to the one its
credential names before any handler runs, and an admin configures the deployment
where a member uses it. A deployment that never makes a second org is entirely
inside the default one and behaves exactly as it did. See `docs/orgs.md`.

- **The tenancy is bound to the STORE, not passed to it.** No port method takes an
  org and no route accepts one: `PersistenceProvider.forOrg` hands a service the
  eleven repositories already scoped, and the authentication middleware is the one
  place that calls it. The alternative — `listDue(orgId, now, limit)` on seventy
  call sites — makes the boundary a rule each of them has to obey, and a rule
  obeyed sixty-nine times is not a boundary.
- **`org_id` is in the primary key, not beside it.** A tenancy a statement can
  omit is one a statement will omit; in the key, a query that forgot the org does
  not quietly read another one's rows, it fails to parse. Both durable stores
  carry it, with a migration per dialect, and `tenancyConformanceCases` writes the
  SAME ids into two orgs and reads each back, three ways. The in-memory store
  reaches isolation structurally (a dataset per org) where the durable ones filter;
  the suite is what says the two arrangements mean the same.
- **Three reads decide an org and nothing else does.** `TenancyDirectory` is a
  session digest, a key digest, and which org registered a repository — the last
  being what an inbound GitHub delivery has instead of a credential. Nothing on
  that list reads a board, a directory or a registry, and the two digests stay
  unique across every org because they are what the scoping is derived FROM.
- **`org_default` is a fixed id, so nothing has to be migrated by hand.** Every
  row that predates this is backfilled to it, and every caller a deployment cannot
  place — anonymous on `open`, or holding `AUTH_API_KEY` — lands there. Its own row
  is synthesised rather than written, because `GET /api/v1/auth/session` is the
  route every page polls and must not be a write.
- **An org is chosen exactly once, in a signed state.**
  `/api/v1/auth/sign-in/<host>?org=<slug>` puts the slug in the round trip's
  signed claims and the session that comes back is bound to it for good. A slug in
  the callback URL would let anybody who can hand somebody a link decide which
  tenancy they land in; a slug nobody has made is a 404 rather than a quiet fall
  back to the default org, which afterwards looks identical.
- **Two roles: an admin configures, a member uses.** Credentials, API keys, the
  project registry, the reviewer directory and the orgs themselves are an admin's;
  the board, the workspace, attention and AI reviews are everybody's. The role is
  on the reviewer row, because that row IS the membership, and it is read per
  request so a demotion takes effect at once. A KEY carries its own role instead,
  fixed at mint time: a key outlives whoever made it, and inheriting the minter's
  role is how a build script comes to be able to revoke the credentials it runs on.
- **Anonymous is an admin, and rows that predate roles are admins.** `open`
  refuses nobody, so whoever can reach the deployment can already reach every
  route; answering `member` would take the Configuration screen away from the
  laptop the default exists for while changing nothing about who gets at it. Both
  migrations follow the same reasoning backwards for the rows already on disk, so
  an upgrade does not lock an operator out of their own deployment.
- **The first person into an org is its admin.** An operator who creates an org
  does not become a person in it, so any other rule leaves a tenancy with a board,
  a directory and a Configuration screen nobody can open, and no route that could
  fix it.
- **Pausing somebody signs them out.** `deleteForReviewer` was on the session port
  from the day sessions were and nothing called it: `paused` is the only way out of
  the directory, so it is the only thing that means "not them, for now", and a
  state that left a live cookie behind never meant it. A DEMOTION deliberately does
  not, because the role is read per request and already takes effect.
- **The reminder tick walks the orgs**, one pass and one session sweep each, with
  the batch cap per tenancy. It is the one caller that is not inside an org to
  begin with, and a `listDue` reaching across every tenancy would have been the
  single read that could return another org's rows, on the one path with nobody to
  refuse it.
- **The attention bus carries the org.** It is one object per process, so it is
  the one thing `forOrg` cannot hand out a scoped copy of: the org is a parameter
  of `publish`/`subscribe` and `withOrg` binds a `ScopedAttentionBus` beside the
  repositories, so no service passes one. Without it the leak is quiet and
  complete — a live event is filtered by the audience rule, which knows about
  skills and teams and nothing about orgs, and an ask with no required skills
  concerns any available reviewer.
- The SPA asks for none of the admin-only reads when the caller is a member,
  rather than letting them find three 403s; it names the org in the rail on a
  deployment that has more than one, and the reviewer form and the key-minting
  form both grow a role. The Configuration link stays in the rail for everybody,
  because it holds the only sign-out button there is.
- **A Slack command still acts on the default org**, and that is the known limit.
  One Slack app serves every tenancy because its signing secret is deployment
  wiring; placing a command by searching every org's directory for the Slack id
  would be a read across the boundary on an unauthenticated path. Closing it needs
  an org's own Slack connection, which is a credential change rather than a routing
  one.
