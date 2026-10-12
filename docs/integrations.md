# GitHub, GitLab and Slack

GitHub and GitLab are where reviews happen and where the verdict has to land.
Slack is where the nudge arrives. This is how sainte-beuve connects to each,
what each one can make it do, and what has to be registered where.

Everything here is optional. A deployment with none of them still serves the
board, and `GET /health` reports which halves are wired, per host.

Both source-control hosts sit behind ONE port (`VcsGateway`), with one adapter
each. Nothing above the adapter knows a merge request from a pull request: a
project is `owner/repo` on either, a person carries a handle per host, and
`resolveVcs(container, provider)` answers which credential that host is being
reached with. Adding a third host is an adapter directory plus one entry in
`createGatewayFactory`.

## Connecting to GitHub

There are three ways, and they are **not alternatives to pick between at deploy
time**. Whichever are configured are offered on the Configuration screen, and the
strongest one present is what calls are actually made with:

| Method                    | What it is                                                | Configured by                                                |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| **GitHub App**            | An installation token, minted per repository, ~1h life    | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` |
| **Sign in with GitHub**   | A user token from an OAuth round trip, stored sealed      | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`       |
| **Personal access token** | A token pasted on the Configuration screen, stored sealed | nothing but `SETTINGS_ENCRYPTION_KEY`                        |
| `GITHUB_TOKEN`            | The same thing, in the process environment                | `GITHUB_TOKEN`                                               |

The order is the precedence, and the reasons are worth stating because an operator
has to be able to predict it:

- **The App wins** because it is the only credential that is not a person's. A
  hosted deployment authenticating as somebody's account breaks when that person
  leaves, and their name appears on every comment the bot makes.
- **A sign-in beats a pasted token** because it was minted through a live
  authorisation against this deployment's own OAuth client: the person who
  granted it can revoke it from their GitHub settings, and its scopes are the
  ones the client asked for. A pasted token is long-lived and carries whatever
  scopes whoever made it happened to grant.
- **The environment is last** because it is the one credential nobody can see or
  change from the board.

The Configuration screen reports which method is in force, and says so when a
stored credential is being shadowed by a stronger one. That is what the `inUse`
flag on a credential means: not "stored", but "this is the one the next request
authenticates with".

### There is no installation table

An App installation is resolved from the repository it is being used for
(`GET /repos/{owner}/{repo}/installation`) and cached in memory. The alternative,
a binding written once at install time, is a row that silently stops matching the
day somebody changes the App's repository access on GitHub, and its only advantage
would be saving a request that is already cached.

So the install callback stores nothing. The App becomes usable the moment GitHub
says it is installed.

The cached lookup is not permanent either: uninstalling and reinstalling the App
mints a new installation id, so a mint that comes back 404 drops the cached entry
and asks GitHub once more. A reinstall therefore needs no redeploy, and a genuine
uninstall still reports itself as one.

### Signing in is not signing in

"Sign in with GitHub" **connects GitHub**. It does not create a session, because
there are no sessions yet (slice 6 of [the plan](./implementation-plan.md)): the
callback seals the resulting token as this deployment's GitHub credential and
does nothing else. Worth saying plainly, because a screen showing a GitHub account
usually means the opposite.

## What GitHub can make it do

Deliveries arrive at `POST /webhooks/github`, signed. Without
`GITHUB_WEBHOOK_SECRET` every one of them is refused with a 503 naming the
variable: an unsigned event is a stranger's POST, and acting on one would let
anybody close a review.

| Event                                    | What happens                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `pull_request` opened / reopened / ready | Tracked on the board, unassigned                                               |
| `pull_request` closed                    | The review is closed and the reminder clock stops                              |
| `pull_request_review` submitted          | Resolved to `approved` or `changes_requested`; a bare comment resolves nothing |
| the review label is added                | Tracked if it was not, and handed to a reviewer                                |
| the AI-review label is added             | Handed to cat-factory, or acked and logged when it is not configured           |
| a comment @-mentions the bot             | The command in it runs, and the bot answers on the pull request                |

Opening a pull request tracks it and leaves it unassigned on purpose: opening one
is not the same gesture as asking for a reviewer, and `open` is the state the
reminder ladder exists to shorten. The **label** is how a team asks for one now.

**Only a repository an org registered is acted on.** A delivery is placed by the
project registry, and one for a repository nobody registered is acked and
dropped (`ignored:unregistered`), the default org included. A GitHub App can be
installed by anybody who finds it, and falling back to the default org would hand
whoever installed it on their own repository that org's reviewers, its
installation tokens and its cat-factory budget. Register each repository on the
Repositories screen, or link it in cat-factory when the org follows its
workspaces; a single-tenant deployment does this too.

**Only the repository's own people are listened to.** A comment command and a
submitted review count only when GitHub reports the author's
`author_association` as `OWNER`, `MEMBER` or `COLLABORATOR`. On a public
repository anybody can comment and review, and without this any GitHub account
could spend the org's cat-factory budget with `@bot ai` in a loop, pull reviews
off people with `@bot reroll`, or settle a tracked review with a drive-by
approval. A stranger's mention gets SILENCE rather than a refusal, because an
answer would be a way to make the bot comment at will. Labels need no such check
(adding one takes triage access, which the repository's owner granted), and an
opened pull request is tracked from anybody, because that asks nobody and spends
nothing.

### Labels

Three rules, named by `GITHUB_LABEL_REVIEW`, `GITHUB_LABEL_AI_REVIEW` and
`GITHUB_LABEL_SKILL_PREFIX` (`needs-review`, `ai-review`, `skill:` by default,
and shown on the Configuration screen so a team can read them off it). They are
one vocabulary for both hosts: a GitLab merge request is labelled the same way,
and the variables keep the prefix they were introduced under.

- `needs-review` opens a review request and finds it a reviewer.
- `ai-review` hands the pull request to cat-factory.
- `skill:payments` makes `payments` a skill the review wants. Skills are a
  preference: the draw favours whoever holds more of the wanted skills and the
  repository's domains, and excludes nobody for missing one.

A label added through the **issues** UI on something that is a pull request
arrives as an `issues` event rather than a `pull_request` one, and is handled
identically. A label on a plain issue is left alone: an issue is not a review
request.

### The bot

Set `GITHUB_BOT_LOGIN` to the App's login, in either of the two forms it has:
GitHub authors an App's comments as `sainte-beuve-bot[bot]` while a person types
`@sainte-beuve-bot`, and both are accepted, because which one a deployment
configured must not decide whether mentions work. It answers when mentioned in a
pull-request comment:

```
@sainte-beuve-bot            find a reviewer (a bare mention means the obvious thing)
@sainte-beuve-bot review     the same, said out loud
@sainte-beuve-bot reroll     hand it to somebody else
@sainte-beuve-bot ai         hand it to cat-factory
@sainte-beuve-bot status     who is on it, and what it needs
```

It acts only for the repository's own people; see above.

The mention is the way in rather than a bare command word, because
`issue_comment` fires on every comment in every watched repository: a bot that
acted on "reroll" appearing in prose would act on a conversation about itself. It
also never answers itself.

A **reroll** hands the review to somebody else and takes it off whoever had it,
in one write: the previous reviewer stops being chased, stops counting as busy,
and has their request withdrawn on the pull request. When there is nobody else to
hand it to, it stays where it is, because "nobody else is available" must not be
a way to end up with a review nobody is on.

It always answers, including when it refuses. A mention that produces silence is
indistinguishable from a webhook that never arrived, and the person who typed it
has no other way to tell. What it says about a refusal is narrower than what an
operator gets: a pull request is public, and the message that names
`SETTINGS_ENCRYPTION_KEY` or which half of cat-factory's configuration is missing
belongs in the deployment's logs. The same goes for a refusal cat-factory itself
wrote, which carries its own response text and what this deployment's key lacks:
the comment says cat-factory declined, and the log says why. Only the board's own
answers ("no reviewer rev-3", "already in flight") are repeated as they are.

Nor does it link to cat-factory. Where this deployment's instance lives (often an
internal host, `http://localhost:8787` in local mode) and the task id it handed
out are not the business of everybody who can read a public pull request; the
board carries the link, behind a sign-in.

A **label** it cannot honour is a different case, and is acked rather than
refused. A 5xx makes GitHub redeliver, and tracking a pull request is idempotent
where an AI-review run is not: every retry would write another run and, once
cat-factory is configured, submit another paid job.

## What GitLab can make it do

Deliveries arrive at `POST /webhooks/gitlab/<org-slug>`, and the default org's
also at `POST /webhooks/gitlab`. GitLab does not sign a delivery: it sends the
webhook's secret token back in `X-Gitlab-Token`, and that token is compared with
the **GitLab webhook secret** stored on the org's GitLab configuration screen.
There is no deployment variable for it, because the GitLab credential is an
org's rather than the deployment's.

The org is in the URL for the reason Slack's is, and the stored secret is what
makes naming it safe. On the bare path a missing secret is answered 503 with the
setting named; on an org's path an unknown slug, an org with no secret and a
wrong token are one 403, so the status code cannot be used to list tenancies.

| Event                                         | What happens                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| merge request opened / reopened               | Tracked on the board, unassigned (a draft waits until it leaves draft) |
| merge request leaves draft                    | Tracked, unassigned                                                    |
| merge request merged or closed                | Closed, the clock stops; a review with a verdict keeps it              |
| merge request becomes approved                | Resolved to `approved`                                                 |
| its approval is taken back                    | An `approved` review goes back on the clock                            |
| the review label is added                     | Tracked if it was not, and handed to a reviewer                        |
| the AI-review label is added                  | Handed to cat-factory, or acked and logged when it is not configured   |
| a comment on a merge request mentions the bot | The command in it runs, and the bot answers on the merge request       |

A label the merge request was created with counts as added, as it does on
GitHub, where each one arrives as its own `labeled` event.

A Merge Request Hook names whoever acted, and the merge request's author only by
id, so the author is known from the payload only when the action is opening it.
A merge request first seen through a label or a comment has its author read
from GitLab before its row is opened, so the router can keep the author off
their own review.

Approval follows GitLab's own rules: `approved` and `unapproved` are the merge
request as a whole becoming, or ceasing to be, approved. One person approving
under rules that want two settles nothing, the way a bare GitHub review comment
does not. GitLab has no "changes requested" event, so a review settles that way
only from the board.

**Only a project the org registered is acted on**, as on GitHub: a verified
delivery about any other project is acked and dropped (`ignored:unregistered`).
The token proves who configured the webhook, not that the org took
responsibility for the project.

**Only people the directory knows are answered.** A GitLab note says nothing
about how its author relates to the project, so a comment command runs only for
somebody this org's reviewer directory holds by that GitLab handle. Anybody else
gets silence, for the reason a GitHub stranger does.

The bot is the account of the GitLab credential stored for the org, because
that is the account its replies are posted as and therefore the name people
mention. It answers only when GitLab marks that account as a bot: a project or
group access token, or a service account. A person's own token or sign-in still
reaches GitLab, but with it every mention of that person would read as a
command, so comment commands stay off. GitLab is asked when the token is
stored. An org reaching GitLab only through the deployment's `GITLAB_TOKEN` has
no account recorded, and comment commands are off until it stores one.

Deliveries are not deduplicated by `X-Gitlab-Event-UUID`, any more than GitHub's
are by delivery id. Every intent is safe to perform twice, and an AI review is
held to one run in flight by its own admission rule.

## What Slack can make it do

Outbound needs a bot token (on the Configuration screen, or `SLACK_BOT_TOKEN`):

- a new review request is announced in `SLACK_CHANNEL_ID`, with buttons;
- reminders are delivered by the clock, as a DM to the assigned reviewer or to
  the channel. Four kinds: the review nobody took, the reviewer who has gone
  quiet, one escalation past the deadline, and the delegated AI review that has
  parked on its findings and is waiting to be curated. All four are the same
  row, so all four are snoozable with `/review snooze` and all four record why a
  delivery failed.

Inbound needs a **signing secret**, which is a separate capability: a deployment
can post out without being able to trust anything coming back, and the
Configuration screen reports the two halves separately for that reason. Both the
slash command and the buttons POST to the same URL.

**Which URL is per org**, because one Slack app serves one tenancy:

| The org                | The Request URL                                 | The secret it is verified against                      |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| the default one        | `/webhooks/slack`, or `/webhooks/slack/default` | its stored signing secret, else `SLACK_SIGNING_SECRET` |
| any other, slug `acme` | `/webhooks/slack/acme`                          | the signing secret stored on ITS Configuration screen  |

The slug in that URL is what places a command on one board rather than another's,
and the org's own secret is what makes naming it safe: a stranger can write any
slug and cannot produce a signature that verifies against the secret that slug
selects. Every refusal before a verified signature is the same 403, so a slug
nobody has made and a signature that does not match are one answer rather than a
way to enumerate this deployment's orgs.

**The deployment's own Slack app is the default org's, all three parts of it.**
`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` describe one
Slack app in one workspace, and none of them is lent to a named org: lending the
secret would let anybody who can sign for that app act on every tenancy, and
lending the other two would post one org's review titles, URLs and reviewer names
into another's channel. A named org connects its own Slack app — a bot token and
a signing secret on its own Configuration screen — or has no Slack at all. It has
no announcement channel of its own yet, so its reminder DMs go out and its
announcements do not.

The Configuration screen shows the URL for the org you are signed in to, with this
deployment's base URL filled in, so the value to paste into Slack is never
assembled by hand. A deployment that never made a second org is entirely inside
the default one, and everything above it is the behaviour it already had.

```
/review                      what is waiting
/review take <id>            put yourself on one
/review reroll <id>          hand it to somebody else
/review snooze <id> [hours]  push the next nudge out (a day by default)
/review ai <id>              hand it to cat-factory
```

Every command that changes something (`take`, `reroll`, `snooze`, `ai`) maps
the Slack user id to a reviewer row by its `slackUserId` first, and does nothing
for somebody the directory does not hold. A Slack signature proves Slack sent the
request, not who typed it, and any member of the workspace (a guest included,
where the command is enabled) can type `/review`. When there is no such row the
reply says so and quotes the id to paste, because that is the state every fresh
deployment is in. A paused row changes nothing either, and a **reroll** (which
takes the review off whoever has it) comes only from the person who has it or an
admin. Listing what is waiting asks nobody: it writes nothing.

`/review` on its own lists what is waiting, the reviews nobody is on first and
the longest-waiting before the rest, capped at ten. The order is what makes the
cap safe: on a busy board the reviews somebody reading the list could actually
pick up are the ones that would otherwise fall off the end of the message.

A **snooze** defers the outstanding nudge and keeps its kind and its target. It is
not a cancel, and it does not widen the audience: turning a DM into a channel post
would make asking for time cost something. With nothing outstanding to copy it
targets whatever the policy would have chased next, which for an assigned review
is the reviewer's DM.

It defers the LADDER, not the row, and that is why the pause is recorded on
`snoozedUntil` as well as applied to `dueAt`. The outstanding schedule is rewritten
from scratch every time anything moves the ladder — a status write, a nudge going
out, a poll that found a delegated review parked — so a pause that lived only in
one row's `dueAt` would be undone by the next of those, and the replacement would
come due at a time that has already gone by. `planNextReminder` reads the pause off
the outstanding row, carries it onto whatever it writes next, and drops it once the
rung it defers would come due after it anyway.

Everything the bot says back is ephemeral. A slash command's reply is addressed to
whoever typed it, and a channel does not need to see somebody's typo.

**Where** the reply goes differs by surface. A slash command is answered in the
HTTP response; a button is answered on the interaction's `response_url`, because
Slack reads a message in the response to a button as a REPLACEMENT for the
message the button is on. Answering a claim in the response body would overwrite
the announcement, and everybody else's buttons with it, with a note addressed to
one person. A response URL needs no bot token, so a deployment that can verify
Slack requests can answer its own buttons whether or not it can post.

### Why plain `fetch` and no Bolt

`@slack/web-api` reaches for `node:os` through its instrumentation layer, which
workerd does not provide, so importing it makes the Worker bundle fail to load.
`@slack/bolt` is not the alternative either: it owns a server and a socket, which
is the wrong shape for a Worker and duplicates the HTTP layer we already have on
Node. Interactivity arrives as signed POSTs to our own route instead.

The same reasoning covers GitHub. `@octokit/auth-app` signs the app JWT with
`node:crypto`, so the App path would have needed hand-writing regardless, and
`crypto.subtle` already signs RS256 on every runtime we target.

## Connecting to cat-factory

cat-factory runs the AI review and the guided review. Everything about reaching
it belongs to an org and is set on that org's Configuration screen, never in the
environment:

| Setting     | What it is                                             | Needed for                    |
| ----------- | ------------------------------------------------------ | ----------------------------- |
| Base URL    | The instance, `http://localhost:8787` for a local one  | both                          |
| API key     | `cf_live_<keyId>.<secret>`, stored sealed              | both (`decide` for AI review) |
| Service id  | The `blk_…` frame for a repository no service backs    | neither                       |
| Pipeline id | Overrides the review task's own pipeline (`pl_review`) | neither                       |

An AI review is filed under the service that backs its repository, read from
the cat-factory workspace that links it, and in that workspace. The repository
mirror described under "Repositories come from cat-factory" is what says which
workspaces link it. The service id is the fallback for a repository no service
backs, a monorepo for one, filed in the linking workspace that holds it, and a
review on such a repository is refused while it is unset.

A guided review needs no service, but it lives in a workspace too, and a key
reaching several workspaces is refused a call that names none. It is opened in
the workspace that links the repository, the first by id when several do, and
one already open in any of them is reused. A call about a session names its
pull request as well, so it is made in the workspace that links the repository
without a lookup first. Only a repository linked in several workspaces makes it
read the session in each, and cat-factory answers 404 in all but one.

The key spends one org's budget and the service is one org's repository frame,
so a deployment-wide value would be lent across the tenancy boundary. That is the
rule the Slack app follows too, except that cat-factory has no default-org
exception: no org can borrow another org's cat-factory.

The settings sit in `integration_configs`, beside the sealed key in
`integration_tokens`, so the screen can show them back without opening a
credential. **Test connection** checks a configuration before or after saving it:
that the instance answers, that it accepts the key, that the key's scope can file
an AI review, and that the service and pipeline exist. It lists the services and
pipelines the key can see, so an admin picks one rather than copying an id out of
cat-factory. A key typed into the form is tested before the stored one.

Local mode prefills the form with a local cat-factory's defaults. Nothing reaches
cat-factory until an admin saves them.

`GET /api/v1/capabilities` answers whether the org can run an AI review and a
guided review, for any member. The board and the guided review page read it to
warn before a button fails.

### Repositories come from cat-factory

Once an org has a base URL and a key, its repository list is the set of
repositories linked in its cat-factory workspaces. Linking one there registers it
here, unlinking it removes it, and a rename on the host follows without losing
the project's skills, domains or merge settings, because a project is matched by
the host's repository id. Adding and removing a repository on the Repositories
screen is refused while this is on; editing a project is not.

The first sync adopts every project already registered for a repository
cat-factory links, and **removes every project it does not link**. While the
directory has never listed a single repository nothing is removed, and the
screen says so: a key that reaches no workspace looks exactly like that, and
must not empty the list. The `repositoryDirectory` capability says whether an
org is in this mode.

It reads cat-factory's account directory (`/api/v1/directory/*`) through
`@cat-factory/directory-sync`:

| When                                   | What runs                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| the first tick after it is set up      | a full walk of the directory snapshots                       |
| every five minutes, on the clock       | the change feed, from where the last sync stopped            |
| once a day, on the clock               | the full walk again, which repairs anything the feed missed  |
| cat-factory pushes a change            | the push is verified and applied, then the feed is caught up |
| **Sync now** on the cat-factory screen | the full walk, and the webhook registration                  |

Pushes arrive at `POST /webhooks/cat-factory/<org-slug>`, signed with a secret
this deployment mints and stores sealed. sainte-beuve registers that URL with
cat-factory itself during a full walk, which needs `API_BASE_URL` to be a public
HTTPS address and a key with the `admin` scope that reaches every workspace. A
key that cannot register one still works: the feed is followed on the clock, and
the screen says changes are polled. Every refusal on that route is the same 403,
for the reason the Slack one is.

Changing the base URL, replacing or clearing the key, or clearing the settings
removes the webhook, the mirrored directory and the push secret. The projects
stay, and are an admin's to manage again until a key is back in place.

What is mirrored is held in `external_repositories`, keyed by source, so another
system that lists repositories can feed the same projects through the same
planner (`planProjectSync`) without a table of its own. An entry is written in
one statement that keeps a newer `seq`, so a push and the clock syncing at once
cannot put back a state the other already moved past. Two projects that swap
names on the host pass through a parking name, so no rename lands on a name
another project still holds.

### Reviewers and teams come from cat-factory too

The same directory sync keeps the reviewer pool and the teams in step with the
account's people and workspaces:

- Each cat-factory workspace becomes a team, matched by the workspace id, so a
  rename there renames the team and moves it on every reviewer in it. A team an
  admin already made under the same name is adopted. A workspace that goes away
  removes its team; while the directory has never listed a workspace, nothing is
  removed.
- Each cat-factory user is matched to a reviewer: the one already following
  them, else the one their GitHub or GitLab account is linked to here, else the
  one with that handle on that host and no other account linked on that host.
  Somebody unmatched becomes a new reviewer, and the account is linked to the
  reviewer, so their sign-in lands on that row.
- A new reviewer joins paused, with no skills. A source can list hundreds of
  people at once, and drawn straight away they would take reviews nobody chose
  them for. The cat-factory screen counts the followed reviewers still paused
  with no skills; an admin gives them skills and resumes them.
- A followed reviewer the directory stops listing is paused and signed out,
  never deleted. Coming back does not resume them; an admin does.
- The directory owns a followed reviewer's name, handles and team (one of the
  teams their workspaces put them in, which is what the reviewer form offers).
  Changing those here answers 409 while the sync is on, as renaming or deleting
  a followed team does. Skills, domains, weight, availability, role and Slack
  stay this org's.
- Clearing cat-factory, or pointing it at another instance, lets go of the
  teams and reviewers it followed. They stay, now the admins' to edit, and a
  later connection matches them afresh.

Matching needs the host accounts cat-factory publishes on a directory user
(`accounts`, from OpenAPI 1.83.0,
[kibertoad/cat-factory#2358](https://github.com/kibertoad/cat-factory/pull/2358)).
An instance without them lists every user with none: the workspaces still become
teams, nobody is matched or added, and the cat-factory screen counts the people
it could not match. Everyone is matched on the first sync after the instance
upgrades, because the daily walk reads every user again.

cat-factory lists users only to a key that reaches every workspace. A key
limited to some workspaces is refused them (`403 account_scope_required`): its
workspaces still become teams, nobody is matched or added, and the cat-factory
screen says the key is why, from what `GET /api/v1/me` reports at each full
walk.

The teams and reviewers are brought to the mirror after a sync that moved the
feed position or walked the snapshots. A catch-up that found nothing new since
the last completed one writes nothing, so a reviewer an admin adds by hand is
matched on the next change in cat-factory or the next daily walk.

People, groups and memberships are mirrored in `external_directory`, keyed by
source and kind, beside `external_repositories`. Turning the sync on for an org
that already followed repositories walks the snapshots once, since its cursor is
past every user and workspace it used to read past.

## Registering it

The URLs are shown on the Configuration screen, filled in with this deployment's
own base URL. They sit outside `/api/v1` deliberately: they are typed into a form
on github.com, gitlab.com and slack.com by hand, so they have to survive an API
version bump.

### A GitHub App

1. **Settings → Developer settings → GitHub Apps → New GitHub App.**
2. **Webhook URL**: `https://<your-api>/webhooks/github`. Set a secret, and give
   the same value to `GITHUB_WEBHOOK_SECRET`.
3. **Callback URL**: `https://<your-api>/connect/github/callback`, for
   "Sign in with GitHub". Add `http://localhost:8788/connect/github/callback` too
   if you develop locally; GitHub accepts several.
4. **Setup URL**: `https://<your-api>/connect/github/setup`, so the browser lands
   back on the Configuration screen after an install.
5. **Repository permissions**: `Pull requests: Read & write` (to request
   reviewers, comment, and read who reviewed the repository recently), `Issues: Read & write` (a pull request's comments are
   the issues API), `Contents: Read & write` (to merge from My PRs),
   `Metadata: Read-only`.
6. **Subscribe to events**: `Pull request`, `Pull request review`, `Issues`,
   `Issue comment`.
7. Generate a private key, convert it once, and set the three variables:
   ```bash
   openssl pkcs8 -topk8 -nocrypt -in downloaded-key.pem -out key.pk8.pem
   ```
   `GITHUB_APP_ID` is the numeric id on the App's page, `GITHUB_APP_SLUG` is the
   name in its URL, and `GITHUB_APP_PRIVATE_KEY` is the converted PEM. They are
   different strings for the same App, and the slug is the one the public install
   page is addressed by.
8. Open the Configuration screen and **Install the GitHub App**.

A key still in PKCS#1 (`BEGIN RSA PRIVATE KEY`) is refused with the conversion
command in the message, because that is the shape GitHub hands out and therefore
the failure everybody meets first.

### A GitLab webhook

1. On the project, or on the group to cover all its projects: **Settings →
   Webhooks → Add new webhook**.
2. **URL**: as the GitLab configuration screen shows it,
   `https://<your-api>/webhooks/gitlab/<org-slug>` (the default org may use
   `https://<your-api>/webhooks/gitlab`).
3. **Secret token**: any long random value. Store the same value as the
   **GitLab webhook secret** on that screen.
4. **Trigger**: `Merge request events` and `Comments`.
5. Register the project on the Repositories screen, or link it in cat-factory
   when the org follows its workspaces.

### A Slack app

The Slack Configuration screen shows a manifest for the org you are signed in
to, with its Request URL, the `/review` command and the bot scopes already in
it:

1. Copy the manifest from the screen.
2. **api.slack.com/apps → Create New App → From a manifest**, pick the
   workspace, paste it, and create the app.
3. **Install to Workspace**, then paste the `xoxb-…` bot token (OAuth &
   Permissions) and the **Signing Secret** (Basic Information) back onto the
   same screen.
4. Set `SLACK_CHANNEL_ID` to the channel new reviews are announced in. It is the
   **default org's** channel, like the two credentials above it; a second org has
   no announcement channel yet.

The manifest is built on `API_BASE_URL`, because Slack keeps the URL and posts
to it from then on. Slack only accepts an https URL, so a deployment without
`API_BASE_URL`, or with an `http` one, gets a line on the screen naming what to
set instead of a manifest. Locally that means a tunnel (see below).

The manifest sets the following, which is also the reference for an app made
by hand or for checking one that already exists:

- **OAuth & Permissions**: bot scopes `chat:write`, `chat:write.public` and
  `commands`. `chat:write` covers every message the app posts or updates. A DM
  (a personal reminder, an attention ask) is posted to the person's user id,
  which `chat:write` covers: the app never opens a conversation itself, so it
  needs no `im:write`. `chat:write.public` lets the announcement reach a channel
  the bot has not been invited to, and `commands` is what a slash command needs.
- **App Home**: **Messages Tab** on, with "Allow users to send Slash commands
  and messages from the messages tab" ticked. That tab is where the app's DMs
  land, so with it off a person is never shown the attention asks and reminders
  sent to them, and a read-only tab refuses the `/review` typed under one. A
  plain message sent there is not read.
- **Interactivity & Shortcuts**: on, Request URL as the Configuration screen
  shows it: `https://<your-api>/webhooks/slack/<org-slug>`. The default org's
  slug is `default`, and it also answers on `https://<your-api>/webhooks/slack`.
- **Slash Commands**: `/review`, same URL.

The default org may set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` on the
deployment instead of storing them; a second org has to store both, because the
deployment's own credentials are not lent across the boundary.

### Locally

GitHub, GitLab and Slack all have to reach the API, which a laptop is not. A tunnel is
enough:

```bash
cloudflared tunnel --url http://localhost:8788
```

and point the webhook and Request URLs at whatever it prints. The outbound halves (posting
to Slack, commenting on GitHub) need no tunnel at all, so a local run can exercise
most of this with just a bot token and a personal access token.
