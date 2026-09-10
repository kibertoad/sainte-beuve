---
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Address the review of the workspace slice: the host is now part of every key
that needs it, the viewer resolves on a deployment that holds a GitHub App, and
the CORS wildcard stops at writes.

Identity, per host rather than per name. `partitionForViewer` takes the whole
handle map and matches each pull request against the name the viewer holds on
ITS host, so a stranger whose GitHub login is what the viewer is called on
GitLab no longer arrives in their own list with the buttons that act on it. The
same key was missing from `ReviewCommitmentRepository.find` (two changes at
`platform/api#12`, one on each host, were one row) and from the skill vocabulary
the attention modal offers.

The viewer resolves through the credential that acts as a PERSON. An App
installation token identifies nobody, so a deployment holding an App and a
sign-in used to answer 503 on `/me`, `/workspace`, `/attention` and the stream,
telling the operator to sign in, which they had. Repository calls still go
through the App: that is the stronger credential for reaching a repository, it
is just not somebody.

`IdentityRepository.link` now answers which reviewer holds the account, and the
account is claimed before the row is written. Three requests from one page load
(the workspace, the inbox, the stream) each found no row and created one, which
forked the directory into three people with a single identity between them.

Also in this pass: a blank `GITLAB_BASE_URL` or `GITHUB_API_BASE_URL` reads as
unset instead of building every URL relative, both hosts' pull request lists
follow their pages instead of stopping silently at 100, committing twice to an
ask you already answered is the documented no-op rather than a 409, gateways
built from a stored credential live long enough for their `identify()`
memoisation to mean something, the schema defaults that were shared mutable
objects are factories, and the inbox refetches when the live stream reconnects
instead of reading "live" beside a list missing everything raised while it was
down.
