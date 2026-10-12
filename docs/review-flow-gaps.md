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
| 1   | Ranked reviewer recommendations, with the reason for each     | 2    |            | In review   | [#31](https://github.com/kibertoad/sainte-beuve/pull/31) |
| 2   | Pick recommended reviewers and send each a named ask          | 3    | 1          | In review   | [#34](https://github.com/kibertoad/sainte-beuve/pull/34) |
| 3   | A named ask reaches the reviewer as a Slack DM                | 3    | 2          | In review   | [#36](https://github.com/kibertoad/sainte-beuve/pull/36) |
| 4   | Bonus for past reviews in the same repository                 | 2    | 1          | In review   | [#35](https://github.com/kibertoad/sainte-beuve/pull/35) |
| 5   | An AI review files under its repository's cat-factory service | 5    |            | In review   | [#33](https://github.com/kibertoad/sainte-beuve/pull/33) |
| 6   | Start an AI review from any pull request row                  | 5    |            | In review   | [#32](https://github.com/kibertoad/sainte-beuve/pull/32) |
| 7   | Decline an ask, and re-ask the next candidate                 | 3    | 2          | Not started |                                                          |
| 8   | A commitment requests the reviewer on the host                | 3, 4 |            | In review   | [#30](https://github.com/kibertoad/sainte-beuve/pull/30) |
| 9   | One matching rule for assignment and asks                     | 2    | 2          | Not started |                                                          |
| 10  | cat-factory workspaces and users feed teams and reviewers     | 1    |            | Not started |                                                          |
| 11  | GitLab webhook intake                                         | 5    |            | Not started |                                                          |
| 12  | Challenge an AI review finding                                | 5    |            | In review   | [#39](https://github.com/kibertoad/sainte-beuve/pull/39) |
| 13  | A guided review names its cat-factory workspace               | 5    | 5          | In review   | [#37](https://github.com/kibertoad/sainte-beuve/pull/37) |
| 14  | Board lookups tell GitHub and GitLab apart                    | 5    |            | In review   | [#41](https://github.com/kibertoad/sainte-beuve/pull/41) |

Status is one of: Not started, In progress, In review, Merged.

## The gaps

### 1. Ranked reviewer recommendations

`selectReviewers` in `@sainte-beuve/reviewers` makes a weighted random draw and
the board assigns the result outright. `scoreCandidates` already scores every
eligible reviewer, but no route returns those scores and no screen shows them, so
an author cannot see who fits best or why. A `ScoredCandidate` counts the skills
and domains a reviewer matched without naming them, so the reason is not there
to return yet.

A route returns the candidates for a pull request ranked by how well they fit, each with the
skills and domains it matched and the load it carries, and the Ask for attention
modal shows that list.

### 2. Named asks to picked reviewers

An attention request goes to everyone available who holds every wanted skill,
narrowed to the requester's team when they ask for that. The author cannot
address it to people.

The modal lets the author tick reviewers from the ranked list. A request with
named recipients reaches exactly those people, and the skill gate applies only
to a request with none.

### 3. Slack delivery of a named ask

Attention requests travel over server-sent events and the REST inbox only, so a
reviewer with no page open never learns they were asked.

A named ask is sent to each recipient as a Slack DM with a commit button when
the org has Slack configured.

### 4. Past reviews in the same repository

Selection reads skills, domains, weight and outstanding reviews. The board's
finished reviews say who reviewed each repository, but nothing reads them when
scoring a candidate.

The score gains a bounded bonus for reviews the candidate completed on the same
repository, read from the board's own history, and the recommendation says so.

### 5. Per-repository cat-factory service

`CatFactoryAiReviewGateway` files every AI review under the one service id an org
sets on the Configuration screen. cat-factory backs each linked repository with
its own service, so every repository but one is reviewed under the wrong service.

The service is resolved per repository from cat-factory's repository listing,
which names the service backing each linked repository. The directory feed the
repositories are synced from does not carry it. The org setting stays the
fallback, which a monorepo always needs: it can back several services, so the
listing names none for it.

### 6. AI review from any pull request row

The AI review button lives on board rows only. A pull request reaches the board
through a label, a webhook, Slack or the API, so the workspace and My Reviews
offer only the guided review, and My PRs offers neither.

Those rows gain an AI review action that registers the pull request on the board
when it is not there yet and files the review.

### 7. Declining an ask

"I will review it" is the only answer to an ask. The requester cannot tell a no
from silence, and nothing moves on to the next candidate.

A recipient can decline. A named ask that still needs commitments offers the
next ranked candidate to the requester, or asks that candidate directly when the
author opted into that.

### 8. A commitment on the host

Committing, through an ask or straight to a pull request, records a commitment
row only. The host is not told, so the pull request still shows nobody
requested.

A commitment requests the reviewer on GitHub or GitLab, best-effort the way
`mirrorAssignment` mirrors a board assignment, and releasing it removes the
request.

### 9. One matching rule

Board assignment scores skills and domains as a preference, while an attention
request without named recipients requires every skill and ignores domains. The
README, the implementation plan and `docs/integrations.md` still describe the
ALL-of gate as the selection rule.

Both paths share one rule, and the docs describe it.

### 10. cat-factory workspaces and users

The directory sync reads users, workspaces and memberships and drops them. All
the repositories a key reaches become one flat list.

Workspaces map to teams and directory users to reviewers, matched on their host
accounts, so the pool and the teams follow cat-factory the way the repositories
already do.

### 11. GitLab intake

No GitLab webhook lands here, so a merge request never opens a board row by
itself, and the label rules (`GitHubLabelRules`) are read for GitHub only.

A signed GitLab webhook opens, labels and closes board rows the way the GitHub
one does, under the same label rules.

### 12. Challenging a finding

cat-factory can dispatch an investigator that upholds, strengthens or retracts a
finding. The curation screen has no way to ask for it.

A challenge action on a finding files the investigation and shows the verdict on
the finding.

### 13. A guided review names its workspace

`CatFactoryGuidedReviewGateway` sends no workspace on any call. cat-factory
refuses a workspace-scoped call that names none when the key reaches several
workspaces, so the guided review fails for every repository of such an org.

Opening and looking up a session use the workspaces the org's repository mirror
links the repository in. A call about a session names its pull request too, and
is made in the workspace those same keys name.

### 14. Board lookups by host

`ReviewRequestRepository.getByPullRequest` matches a pull request on owner, repo
and number alone. A GitHub pull request and a GitLab merge request with the same
names resolve to each other's board row, so an intake for one can update the
other's review or refuse to track it.

The provider is part of the key: the port takes it, all three stores filter on
it, and both durable stores carry a `pr_provider` column backfilled from the
payload, with the lookup index leading on it.
