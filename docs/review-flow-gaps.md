# Review flow gaps

The flow this tracker measures against, from the pull request author's side:

1. Workspaces and repositories are synced from cat-factory.
2. The author asks for reviewer recommendations: the best match on skills and
   domains, with a bonus for past reviews in the same repository.
3. The author picks reviewers, and each one is asked whether they will commit to
   the review.
4. A committed reviewer opens the pull request on GitHub or GitLab for a manual
   review.
5. Or they launch a guided review or a fully automated one, and curate its
   results before anything is posted.

Gaps are ordered by how far they block that flow: a step that does not exist,
then a step that fails for most repositories, then a step that works with
friction, then polish. Each row ships as one pull request and is done when that
pull request is merged with its review findings fixed.

## Tracker

| #   | Gap                                                           | Step | Depends on | Status      | PR                                                       |
| --- | ------------------------------------------------------------- | ---- | ---------- | ----------- | -------------------------------------------------------- |
| 1   | Ranked reviewer recommendations, with the reason for each     | 2    |            | Merged      | [#31](https://github.com/kibertoad/sainte-beuve/pull/31) |
| 2   | Pick recommended reviewers and send each a named ask          | 3    | 1          | Merged      | [#34](https://github.com/kibertoad/sainte-beuve/pull/34) |
| 3   | A named ask reaches the reviewer as a Slack DM                | 3    | 2          | Merged      | [#36](https://github.com/kibertoad/sainte-beuve/pull/36) |
| 4   | Bonus for past reviews in the same repository                 | 2    | 1          | Merged      | [#35](https://github.com/kibertoad/sainte-beuve/pull/35) |
| 5   | An AI review files under its repository's cat-factory service | 5    |            | Merged      | [#33](https://github.com/kibertoad/sainte-beuve/pull/33) |
| 6   | Start an AI review from any pull request row                  | 5    |            | Merged      | [#32](https://github.com/kibertoad/sainte-beuve/pull/32) |
| 7   | Decline an ask, and re-ask the next candidate                 | 3    | 2          | Merged      | [#38](https://github.com/kibertoad/sainte-beuve/pull/38) |
| 8   | A commitment requests the reviewer on the host                | 3, 4 |            | Merged      | [#30](https://github.com/kibertoad/sainte-beuve/pull/30) |
| 9   | One matching rule for assignment and asks                     | 2    | 2          | Merged      | [#43](https://github.com/kibertoad/sainte-beuve/pull/43) |
| 10  | cat-factory workspaces and users feed teams and reviewers     | 1    |            | Merged      | [#42](https://github.com/kibertoad/sainte-beuve/pull/42) |
| 11  | GitLab webhook intake                                         | 5    |            | Merged      | [#40](https://github.com/kibertoad/sainte-beuve/pull/40) |
| 12  | Challenge an AI review finding                                | 5    |            | Merged      | [#39](https://github.com/kibertoad/sainte-beuve/pull/39) |
| 13  | A guided review names its cat-factory workspace               | 5    | 5          | Merged      | [#37](https://github.com/kibertoad/sainte-beuve/pull/37) |
| 14  | Board lookups tell GitHub and GitLab apart                    | 5    |            | Merged      | [#41](https://github.com/kibertoad/sainte-beuve/pull/41) |
| 15  | Attention answers are written atomically                      | 3    |            | Merged      | [#44](https://github.com/kibertoad/sainte-beuve/pull/44) |
| 16  | One commitment per reviewer and pull request                  | 3    |            | In progress |                                                          |

Status is one of: Not started, In progress, In review, Merged.

## The gaps

### 1. Ranked reviewer recommendations

`POST /reviewers/recommendations` returns the candidates for a pull request,
best first, each with its fit and the reasons it ranks there: the wanted skills
and domains it matched, the reviews it already carries, and its past reviews in
the repository. The Ask for attention modal shows that list.

### 2. Named asks to picked reviewers

The modal lets the author tick reviewers from the ranked list. A request with
named recipients reaches exactly those people, after the server checks each one
is in the directory, available and not the requester. The fit and team gate
applies only to a request with none.

### 3. Slack delivery of a named ask

When the org has Slack configured, each named recipient with a Slack id gets a
DM saying who asks, for which pull request and what of the ask they match, with
a commit button. The DM is updated as the ask moves on. Slack failing costs the
DM and never the ask.

### 4. Past reviews in the same repository

Selection and the recommendations add a bounded, diminishing bonus for reviews
the candidate finished on the same repository in the last six months, read from
the board's history and the host's verdicts. A recommendation names the count.

### 5. Per-repository cat-factory service

`CatFactoryAiReviewGateway` reads the workspaces that link the repository from
the org's directory mirror, asks each which service backs it, and files the
review there. The service id an org sets on the Configuration screen is the
fallback for a repository no service backs, such as a monorepo.

### 6. AI review from any pull request row

The workspace, My PRs and My Reviews show an AI review action on rows in a
linked repository once the org has cat-factory. It registers the pull request
on the board when it is not there yet and files the review on that row.

### 7. Declining an ask

Anybody the ask reached can decline, with an optional reason, from the inbox or
the Slack DM. A named ask the declines leave short asks the next ranked
candidate by itself when the requester kept "ask the next best match" ticked,
and otherwise shows the requester the shortfall with a one-click ask.

### 8. A commitment on the host

Committing, through an ask or straight to a pull request, requests the reviewer
on GitHub or GitLab, best-effort the way `mirrorAssignment` mirrors a board
assignment. Releasing the commitment withdraws the request when the commitment
made it and no active board assignment names the same person.

### 9. One matching rule

Board assignment, the recommendations and an attention request without named
recipients all measure the same share of wanted skills and domains. The board
weights its draw by it, the recommendations sort on it, and a broadcast reaches
whoever holds at least `ATTENTION_FIT_FLOOR` of it. The README, the
implementation plan and `docs/integrations.md` describe that rule.

### 10. cat-factory workspaces and users

With cat-factory configured, the directory sync turns workspaces into teams and
directory users into reviewers, matched on their GitHub or GitLab account, which
cat-factory publishes on a directory user from
[kibertoad/cat-factory#2358](https://github.com/kibertoad/cat-factory/pull/2358).
An instance that does not serve it still turns workspaces into teams and
matches nobody. A new reviewer joins paused with no skills, so a first sync
that adds many people sends no reviews their way before an admin sets them up.

### 11. GitLab intake

A GitLab webhook per org, verified against the secret token that org stored,
opens, labels, settles and closes board rows the way the GitHub one does, under
one host-neutral label vocabulary (`ReviewLabelRules`).

### 12. Challenging a finding

A challenge action on a finding of a parked AI review sends it to cat-factory's
investigator, and the verdict (upheld, amended, retracted or failed) shows on
the finding. A retracted finding is unticked so it never reaches the pull
request.

### 13. A guided review names its workspace

cat-factory refuses a workspace-scoped call that names none when the key
reaches several workspaces. Opening and looking up a guided review session use
the workspaces the org's repository mirror links the repository in. A call
about a session names its pull request too, and is made in the workspace those
same keys name.

### 14. Board lookups by host

A board row is looked up by the kernel's `pullRequestKey` and a repository's
history by `projectRefKey`, the keys projects and commitments already use, so
the host is part of each and the path is compared without case. A GitHub pull
request and a GitLab merge request with the same names resolve to separate
rows. Both durable stores carry the keys as columns, backfilled from each row.

### 15. Atomic answers to an ask

The attention store changes a request only through `change`, which re-reads and
remakes the decision when another write landed in between: a `revision` column
in Postgres and D1, and a read and write with nothing awaited between them in
memory. Two answers at the same moment both land, so no commitment, decline,
added person or recorded DM is dropped.

### 16. One commitment per reviewer and pull request

A commitment is written through `createOrGet`, which inserts and, when the
reviewer already holds one on that pull request, answers that row instead. Both
durable stores enforce it with a unique index on the org, the reviewer and the
`pullRequestKey`, so the host is part of the key and the path is compared
without case; the memory store checks and writes with nothing awaited between
them. Two clicks at the same moment leave one row, and only the call that wrote
it requests the reviewer on the host.
