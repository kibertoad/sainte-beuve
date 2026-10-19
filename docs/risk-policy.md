# Risk assessment and unattended approval

Most pull requests a team opens are small and safe: a typo in the docs, a test
that was missing, a dependency bump CI has already vouched for. Each still waits
for a person. A risk policy lets an org say which of them nobody has to look at,
and sainte-beuve approves those on the host as a bot account the org chose.

Nothing happens until an admin turns it on. The policy is set on the **Risk
policy** screen under Configuration, and a fresh org assesses nothing.

## What an assessment is

A pull request is scored from 0 to 1 on three axes, the same three cat-factory
scores its own runs on:

| Axis         | What it measures                                            |
| ------------ | ----------------------------------------------------------- |
| `complexity` | How much there is to understand: size, files, spread        |
| `risk`       | How likely it is to break something, and how badly          |
| `impact`     | How far it reaches: other code, other teams, the deployment |

Beside the scores it gets a **change class** from its changed paths alone:
`docs`, `test`, `dependency`, `config`, `source` or `schema`, and `unknown` when
the file list could not be read. A diff that mixes classes takes the riskiest
one present, so a rule for `docs` never fires on a diff that also touches code,
and executable source counts as `source` whatever directory it sits in. The rules
are cat-factory's (`classifyChangedFiles` in its kernel), so a pull request is one
class whichever of the two assessed it.

### Who scores it

- **From the changed files** (`heuristic`) needs nothing but a credential that
  can read the pull request. It is deterministic and deliberately conservative:
  it weighs changed lines (prose and tests at a quarter, lockfiles not at all),
  how many files and areas the change spreads over, sensitive paths
  (authentication, payments, CI workflows), removed files, and code changed
  without a test. It can say a small documentation change is harmless. It says
  little more about code than "this is big" or "this touches something
  sensitive", and a host listing cut short scores as maximal.
- **cat-factory** reads the change with a model through its public API
  (`POST /api/v1/pr-assessments`), in the workspace that links the repository.
  It needs the org's cat-factory key with the `write` scope, since an assessment
  spends model budget.

### Which ceilings it is held to

- **This org's ceilings** (`native`): three ceilings, one per axis, and a rule per
  change class. `always` passes the class whatever its scores, `never` holds it for
  a person, and `thresholds` (the default) compares every score to its ceiling.
- **A cat-factory risk policy**: cat-factory judges the pull request by one of its
  own risk policies, the same ceilings and per-class rules its own merges are held
  to, and answers with a verdict rather than its ceilings. No policy named takes
  cat-factory's default for unattended work. This needs cat-factory as the
  assessor too, since it only judges what it scored. Picking a policy from the
  list needs a key with the `admin` scope; without one the screen says so.

Role-scoped rules on a cat-factory policy apply only when the org's key is bound
to a person in cat-factory, who is then the role it is judged under. A key bound
to nobody has no role, and those rules do not apply to it.

## When a pull request opens, or leaves draft

Two switches act on a pull request the moment it becomes a review request: it
opens as a non-draft (`opened` on GitHub, `open` on GitLab), or it leaves draft
(`ready_for_review`, or an update that clears the draft flag). A reopen or a label
is not a new review request and sets off neither.

- **Assess** (`assess`) scores it. It also scores any pull request the board starts
  tracking another way, and it scores again a row the board already held, which
  is how a draft that was tracked by a label (and held, since a draft is never
  approved) gets approved once it is ready. An assessment in flight, or one that
  already approved, is left alone.
- **AI review** (`autoAiReview`) files cat-factory's AI review of it, whatever its
  assessment says. It needs cat-factory configured. The review parks with its
  findings for a person like any other, and it counts against the same limit of
  one in flight and three an hour.

With both on and the policy waiting on an AI review before approving, the review
filed on opening is the one the approval waits on: an assessment adopts a review
of the pull request filed since it was requested, rather than filing and billing a
second. A refusal to assess or to file (cat-factory not configured, the hourly
limit) goes to the log and never fails the webhook delivery, which the host would
otherwise redeliver.

## What happens to a pull request within the policy

With **automatic approval** off, the assessment is a badge on the board row and
nothing else. With it on, a pull request within the policy is approved on the
host, its board row is settled as approved, and its reminders stop.

The policy can also ask for **cat-factory's AI review first**, and the pull
request is approved only when the review vouches for it, by the rule cat-factory's
own reviewer gate applies before a run moves past review:

- nothing still standing at or above the severity the policy names (a finding its
  challenge retracted does not count), and
- a **rating** at or above the policy's minimum, 0.8 by default, which is
  cat-factory's own threshold.

cat-factory's pull-request review reports findings and no score, so the rating is
read off the findings: a review that found nothing rates 1, and each finding
still standing takes off what its severity costs (blocker 1, high 0.25,
medium 0.1, low 0.04, nit 0.01; `AI_REVIEW_SEVERITY_PENALTY` in the contracts).
Two mediums rate 0.8 and pass; three rate 0.7 and do not. A review that failed or
was cancelled vouches for nothing. The rating is kept on the assessment and shown
on the board row's badge.

A clean review is closed without posting. One that did not pass stays parked with
its findings, the row says why (the findings, or the rating against the minimum),
and the parked-review nudge reaches a person the way it always does.

A pull request is never approved when:

- it is a draft, or no longer open;
- its repository is not registered to this org (any member can track any pull
  request, and the deployment's GitHub App reaches every org's repositories);
- its head moved since it was assessed (it is assessed again instead);
- the approver opened it, which both hosts refuse anyway;
- nobody is configured to approve on its host.

Each of these, apart from a moved head, leaves the row `within_policy` with the
reason on it.

## The approver

Approvals go out as one account per host:

1. the org's **approver token** for the host, stored on the Risk policy screen
   (`github-approver-token`, `gitlab-approver-token`), verified against the host
   when it is stored;
2. otherwise, on GitHub, the deployment's **GitHub App**.

A person's sign-in or pasted token is never used to approve: an approval in the
name of somebody who did not look is the one thing this must not produce. Use a
bot account with write access to the repositories. Whether the host's branch
protection counts that account's approval toward its required reviews is the
host's decision, and the place to make it.

## New commits

A push to a tracked pull request is assessed again. When sainte-beuve had approved
it, the approval is withdrawn first (a dismissed review on GitHub, an unapproval
and a note on GitLab) and the board row goes back on the clock, because the
approval was about code that is no longer the head. Branch protection that
dismisses stale approvals does the same on the host's side, and is worth turning
on as well.

## When it runs

An assessment is a row (`risk_assessments`, one per board row) that moves through
its states one step at a time: `pending`, then `approved`, `within_policy`,
`requires_review` or `failed`, with `awaiting_ai_review` between when the policy
asks for a review. The first step starts as the pull request is tracked, after the
webhook has been answered (the request's `waitUntil` on the Worker). Anything left
in flight is driven by the reminder clock once its own step has had three minutes,
and a step that fails is tried three times before the row says why it gave up.

Every write to the row is a check and set on its `revision`. A step claims the
row before it runs, so a deferred step and a clock tick that reach it together do
not both score or approve it. New commits restart the row, and a step that was
approving the old head when they arrived finds its write refused and withdraws
the approval it had just posted.

Any member can ask for a pull request to be assessed again from the API
(`POST /api/v1/reviews/<id>/risk-assessment`), whether or not the org assesses
unprompted. `/health` reports whether cat-factory can assess
(`externalRiskAssessment`) and whether each host has an approver (`autoApproval`).
