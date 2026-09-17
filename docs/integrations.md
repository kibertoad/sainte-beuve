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

### Labels

Three rules, named by `GITHUB_LABEL_REVIEW`, `GITHUB_LABEL_AI_REVIEW` and
`GITHUB_LABEL_SKILL_PREFIX` (`needs-review`, `ai-review`, `skill:` by default,
and shown on the Configuration screen so a team can read them off it):

- `needs-review` opens a review request and finds it a reviewer.
- `ai-review` hands the pull request to cat-factory.
- `skill:payments` makes `payments` a skill the reviewer must have. Skills are an
  ALL-of gate, so two of these means one reviewer holding both.

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
belongs in the deployment's logs.

A **label** it cannot honour is a different case, and is acked rather than
refused. A 5xx makes GitHub redeliver, and tracking a pull request is idempotent
where an AI-review run is not: every retry would write another run and, once
cat-factory is configured, submit another paid job.

## What Slack can make it do

Outbound needs a bot token (on the Configuration screen, or `SLACK_BOT_TOKEN`):

- a new review request is announced in `SLACK_CHANNEL_ID`, with buttons;
- reminders are delivered by the clock, as a DM to the assigned reviewer or to
  the channel. Four kinds: the review nobody took, the reviewer who has gone
  quiet, one escalation past the deadline, and the delegated AI review that has
  parked on its findings and is waiting to be curated. All four are the same
  row, so all four are snoozable with `/review snooze` and all four record why a
  delivery failed.

Inbound needs `SLACK_SIGNING_SECRET`, which is a **separate** capability: a
deployment can post out without being able to trust anything coming back, and the
Configuration screen reports the two halves separately for that reason. Both the
slash command and the buttons POST to `/webhooks/slack`.

```
/review                      what is waiting
/review take <id>            put yourself on one
/review reroll <id>          hand it to somebody else
/review snooze <id> [hours]  push the next nudge out (a day by default)
/review ai <id>              hand it to cat-factory
```

`take` maps the Slack user id to a reviewer row by its `slackUserId`. When there
is no such row it says so and quotes the id to paste, because that is the state
every fresh deployment is in.

`/review` on its own lists what is waiting, the reviews nobody is on first and
the longest-waiting before the rest, capped at ten. The order is what makes the
cap safe: on a busy board the reviews somebody reading the list could actually
pick up are the ones that would otherwise fall off the end of the message.

A **snooze** defers the outstanding nudge and keeps its kind and its target. It is
not a cancel, and it does not widen the audience: turning a DM into a channel post
would make asking for time cost something. With nothing outstanding to copy it
targets whatever the policy would have chased next, which for an assigned review
is the reviewer's DM.

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

## Registering it

The URLs are shown on the Configuration screen, filled in with this deployment's
own base URL. They sit outside `/api/v1` deliberately: they are typed into a form
on github.com and slack.com by hand, so they have to survive an API version bump.

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
   reviewers and comment), `Issues: Read & write` (a pull request's comments are
   the issues API), `Metadata: Read-only`.
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

### A Slack app

1. **api.slack.com/apps → Create New App → From scratch.**
2. **OAuth & Permissions**: bot scopes `chat:write` (and
   `chat:write.public` to post in a channel the bot has not been invited to).
   Install it, and put the `xoxb-…` token on the Configuration screen or in
   `SLACK_BOT_TOKEN`.
3. **Interactivity & Shortcuts**: on, Request URL
   `https://<your-api>/webhooks/slack`.
4. **Slash Commands**: `/review`, same URL.
5. Copy the **Signing Secret** from Basic Information into
   `SLACK_SIGNING_SECRET`.
6. Set `SLACK_CHANNEL_ID` to the channel new reviews are announced in.

### Locally

GitHub and Slack both have to reach the API, which a laptop is not. A tunnel is
enough:

```bash
cloudflared tunnel --url http://localhost:8788
```

and point the two Request URLs at whatever it prints. The outbound halves (posting
to Slack, commenting on GitHub) need no tunnel at all, so a local run can exercise
most of this with just a bot token and a personal access token.
