---
'@sainte-beuve/integrations': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Fix what the GitHub and Slack surfaces do when a gesture, a credential or a
binding is not what the happy path assumed.

- A **reroll** now takes the review off whoever had it as the replacement goes
  on, in one write: their outstanding counter drops, the reminder ladder stops
  chasing them, and `VcsGateway` gains `removeRequestedReviewers` so the pull
  request agrees. When there is nobody else to hand it to, the review stays where
  it is rather than being left with nobody on it.
- **A blank binding counts as unconfigured**, decided in `createContainer` for
  every facade and read with `||` on the Worker as it already was on Node. Every
  example deployment ships each name with no value, and `requireCapability`
  refuses only null: an empty `GITHUB_WEBHOOK_SECRET` used to reach Web Crypto
  and answer GitHub 500 while `/health` called the capability ready, and an empty
  `GITHUB_LABEL_REVIEW` silently matched no label at all.
- **An AI-review label that cannot be honoured is acked**, not answered 5xx.
  GitHub redelivers a failure, and tracking a pull request is idempotent where a
  run is not, so each retry wrote another run and would submit another paid job.
- **A bot reply says less than an operator's 503.** A pull-request comment is
  public, so a refusal carries the shape of the fault and the message naming
  `SETTINGS_ENCRYPTION_KEY` or cat-factory's missing configuration stays in the
  log.
- **`GITHUB_BOT_LOGIN` accepts either form of an App's login** (`name` and
  `name[bot]`), so mentions and the never-answer-itself guard work whichever was
  configured, and `@name[bot] status` reads as `status`. A blank login answers
  nothing instead of treating a bare `@` as a mention of the bot.
- **A Slack button is answered on its `response_url`**, because Slack reads a
  message in the HTTP response to an interaction as replacing the message the
  button is on: claiming a review used to stand to overwrite the announcement,
  and everybody else's buttons with it.
- **Third-party text is escaped before it reaches Slack `mrkdwn`.** A
  pull-request title of `<https://evil.example|Approve here>` rendered as a link
  in the announcement channel, and `<!channel>` in one as a real broadcast.
- **`/review` lists the reviews nobody is on first**, and the longest-waiting
  before the rest, which is what makes the ten-item cap safe: the store answers
  newest-first, so a busy board hid exactly the reviews somebody could pick up.
- **A snooze with nothing outstanding keeps the nudge private.** It now targets
  what the policy would have chased next, where an assigned review used to have
  its DM widened into a channel post.
- **An App reinstall no longer wedges the App path.** A reinstall mints a new
  installation id, so a mint that comes back 404 drops the cached lookup and asks
  GitHub once more.
- **`activeMethod` is always in `availableMethods`.** `app` is offered on the id
  and the key that calls are made with, and the new `appInstallable` carries the
  slug requirement that gates the install button.
- The reminder tick resolves the chat credential once per batch rather than
  re-reading and re-decrypting the bot token for every due reminder, and a failed
  `identify()` is no longer memoised for the life of the gateway.
