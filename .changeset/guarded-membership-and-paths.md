---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/persistence-conformance': minor
'@sainte-beuve/server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/worker': minor
---

Close the six high findings of [docs/security-review.md](../docs/security-review.md).

They share a root the review names: at the edges of a design that otherwise holds,
a few things were nobody's decision. Joining an org was one, a repository's owner
was another, and a string in an API path was a third.

**Membership of an org is a decision now (H1).** An org carries `enrolment`:
`invite`, which admits only an account whose handle an admin registered in the
directory, or `open`, which is what every org did before. `invite` is the default
— including for the default org and for a row written before the field existed,
which decodes as closed rather than as undefined — so the flag lands without a
migration. `POST /api/v1/settings/orgs` takes a `founder`, which seats the
founding admin before anybody is told the slug and so closes the window in which
whoever guesses it first becomes the administrator; `PATCH
/api/v1/settings/orgs/current` moves an org between the two afterwards. The
decision itself is pure — `decideEnrolment` in `@sainte-beuve/reviewers`, over the
org's enrolment, the size of the directory, the row the handle matched and whether
an admin has ever signed in. It is asked on a plain sign-in only: the connect round
trip is admin-only and the `open`-mode viewer is the operator's own credential, so
neither is a stranger arriving with a link. An account already linked keeps signing
in, because closing the door is about who may JOIN.

**A registered handle no longer hands out `admin` (H2).** A handle is a string an
admin typed and a subject is the host's own id, so a pre-registered row is a claim
waiting to be taken: adoption confers its role only while no admin of the org has
signed in — the founder's window — and caps it at `member` after that. Adoption
also skips a row an account has already proved itself against, so whoever holds
the GitHub login `bob` can no longer take the row of the Bob whose GitHub account
is linked to it.

A claim is spent PER HOST, because `handles` has a slot per host and an admin
registers each separately: a row's GitLab slot is untouched by whoever proved
themselves against its GitHub one. That is also the only way a second account is
ever linked — a refresh re-records the handle of a host already linked and nothing
else — so a person who signed in with GitHub can still add their GitLab account,
onto the same directory row rather than a second one. The `admin` cap does not
apply there: it protects an unclaimed registration, and somebody adopting their
own row already holds the role.

**A repository belongs to whichever org registered it first (H3).** `POST
/api/v1/projects` now refuses a ref another tenancy has claimed, rather than
writing a second row that can never win. The refusal names no org, because which
tenancy holds a claim is not a caller's business.

**`owner` and `repo` cannot choose a GitHub path (H4).** The contracts hold both
to the hosts' own alphabet with no `..` and no `/` outside a nested GitLab
namespace, and every GitHub call goes through `repoPath`, which encodes each
segment. Either half alone was enough; both are here because `fetch` normalises
`..` and truncates at `?`, so an unencoded ref chose the METHOD and the PATH the
org's credential was spent on.

**Request bodies are bounded (H5).** `hono/body-limit` at 1 MiB on the two webhook
paths and 128 KiB under `/api/v1`, mounted before anything reads a byte: a webhook
proves itself with a signature computed over the raw bytes, so without a limit a
stranger's POST is a Node process's memory. A refusal is a `payload_too_large`
413 in the ordinary error envelope.

**`AUTH_MODE` fails loudly (H6).** One reading for all three runtimes
(`authModeFrom`): an unrecognised value is a configuration error rather than a
quiet `open`, and `open` beside a public origin — `APP_BASE_URL`, or a
non-loopback `CORS_ORIGINS` entry — refuses to start, because an anonymous caller
there is an admin of the default org. The wildcard names no host and leaves a
local run alone. Both hosted templates ship `AUTH_MODE=required`.

The refusal is a `ConfigurationError` — a new `misconfigured` domain code, 503 —
because the two runtimes can only ask at different moments. Node reads its
environment once and the throw is a process that will not start. A Worker is
handed its bindings with the request and has no boot to fail in, so the same throw
arrives per request; as a domain error it is answered 503 with the sentence Node
prints on stderr, on every path including `/health`, rather than an anonymous 500
legible only in `wrangler tail`.

Breaking, in the honest direction:

- A deployment that sets `AUTH_MODE=open` (or leaves it unset) while naming a
  public origin no longer starts. Set `AUTH_MODE=required`, or drop the origin.
  The error names both.
- On a `required` deployment, an account nobody registered is answered 403 at
  sign-in instead of becoming a member. People who have already signed in are
  unaffected; to go back to the old behaviour, `PATCH
/api/v1/settings/orgs/current` with `{"enrolment":"open"}`.
- A pre-registered `admin` row is adopted as a `member` once the org has an admin
  who has signed in. Promote them afterwards, when you can see which account took
  the row.
