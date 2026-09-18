# UX review

A read of every surface a person meets: the five SPA screens
(`frontend/app/app/pages`), the components under them, the Slack messages and
`/review` replies (`@sainte-beuve/integrations`, `SlackWebhookService`), the bot's
comments on the pull request (`githubReplies.ts`), and the first-run path in
[deploy/local/README.md](../deploy/local/README.md). Done from the source, not from
a running deployment, so anything about rendering at a given width is a reading
of the classes rather than a screenshot.

The product's own rules were the yardstick: the README says the workspace exists
to hand somebody "the three lists they actually have to act on", that an ask
"answers itself", and that a screen should say what is missing rather than show
an empty board. Most findings below are places where a screen breaks one of those
rules, or where two surfaces answer the same question differently.

Severity is about the person, not the code: **high** means somebody is sent to the
wrong place, told something false, or loses work with one click. **Medium** means
they have to work it out. **Low** is polish.

## Summary

| #   | Severity | Surface       | Finding                                                                                   |
| --- | -------- | ------------- | ----------------------------------------------------------------------------------------- |
| 1   | High     | Slack → SPA   | Every reminder links to `/reviews/<id>`, a route the SPA does not have                    |
| 2   | High     | Board         | The board lists every review ever, with no filter, under a subtitle that says otherwise   |
| 3   | High     | Board         | A row never says who is on it, how urgent it is, or when it is due                        |
| 4   | High     | All screens   | Five destructive actions are one click, unconfirmed, with no undo                         |
| 5   | High     | Workspace     | The attention inbox hides its own failure and is not refreshed by Refresh                 |
| 6   | Medium   | Workspace     | A pull request you committed to is listed twice, still offering "I will review it"        |
| 7   | Medium   | Workspace     | Signed out on a `required` deployment, the landing page shows an error and no way in      |
| 8   | Medium   | All screens   | Raw enum values reach the screen (`in_review`, `changes_requested`, `awaiting_selection`) |
| 9   | Medium   | All screens   | One name for the same thing: Board, Reviews, the board                                    |
| 10  | Medium   | All screens   | No loading state: pages block on data, and one panel flashes a false empty state          |
| 11  | Medium   | Configuration | One request in flight spins every button on the page                                      |
| 12  | Medium   | Forms         | Skills are typed by hand on three screens and matched exactly                             |
| 13  | Medium   | Forms         | Disabled submit buttons with no reason, and no Enter-to-submit on Add project             |
| 14  | Medium   | Ask modal     | An unregistered project reads as a project with no skills                                 |
| 15  | Medium   | Board         | "Find a reviewer" succeeds silently; Slack says who got it, the board does not            |
| 16  | Medium   | Configuration | A freshly minted key has no copy button, and closing the alert loses it                   |
| 17  | Medium   | Layout        | Nothing adapts below about 900px, and the Slack nudge is read on a phone                  |
| 18  | Medium   | Copy          | Descriptions are written for the implementer, and some are wrong                          |
| 19  | Low      | Accessibility | Unlabelled checkboxes, colour-only status, new-tab links with no cue                      |
| 20  | Low      | Projects      | Skill edits have no dirty state; Save and Remove share one spinner                        |
| 21  | Low      | Board         | Nothing on the board changes a review's status, though the API can                        |
| 22  | Low      | Navigation    | No screen state lives in the URL, and there is no error page                              |
| 23  | Low      | Slack         | `/review take <id>` asks for an opaque id; the AI hand-off echoes a raw status            |
| 24  | Low      | Configuration | The `?connected=` toast re-fires on every reload                                          |

## Findings

### 1. Reminders link to a page that does not exist

`reminderMessage` in `backend/packages/integrations/src/slack/message.ts:99`
appends `${appBaseUrl}/reviews/${review.id}` to every nudge. The SPA's routes are
`/`, `/projects`, `/board`, `/reviewers` and `/configuration`. There is no
`/reviews/…`, and the board has no way to open or scroll to one row. With
`APP_BASE_URL` set, every reminder lands on Nuxt's default error page, which has
no rail and no link back.

The parked-AI-review nudge is the worst case, and the README singles it out: the
message says the findings are waiting on the board and nothing is on the pull
request yet, then sends the reader somewhere that 404s. The tests in
`message.test.ts:90` and `SlackChatGateway.test.ts:79` assert the broken URL, so
nothing caught it.

**Recommend**: add the route contract-side (a `boardReviewPath(reviewId)` helper
in `@sainte-beuve/contracts` beside `signInCallbackPath`) and use it in both the
message and the SPA. Either a `/board/[reviewId]` page or `/board?review=<id>`
that the board reads on mount to expand and scroll to that row. Fix the two tests
to import the helper rather than restate the path.

### 2. The board shows everything, and its subtitle says it does not

`ReviewController.ts:23` answers `GET /reviews` with `repositories.reviews.list()`
unfiltered, and `board.vue` renders the list flat. Approved, closed and
changes-requested rows sit between open ones in whatever order the store returns
them. The subtitle reads "Everything waiting on a human, and what it is waiting
for", which stops being true the first time a review closes.

The Slack `list` command (`SlackWebhookService.ts`) filters to
`open`, `assigned`, `in_review`. So the two surfaces disagree about what "the
board" is.

**Recommend**: default the board to the same three statuses, with a "Show
settled" toggle (or tabs: Waiting / Settled). Sort by urgency: `dueAt` past, then
`priority`, then age. Fold the filter into the contract as a query parameter so
Slack and the board read one definition.

### 3. A board row does not say who is on the hook

The row shows repo#number, title, required skills, a status badge, and three
buttons. It does not show `assignedReviewerIds` (the contract carries ids only,
no names), `priority`, `dueAt`, `createdAt` or `authorLogin`. For a screen whose
purpose is "what the deployment has taken responsibility for", the reader cannot
tell who has it, how long it has sat, or whether it is overdue.

**Recommend**: extend `reviewRequestSchema` (or the list response) with
`assignedReviewers: { reviewerId, displayName }[]`, which `assignReviewersResult`
already has the shape for, and render names, a relative age ("3 days"), and a due
marker. Priority `high` deserves a visible mark.

### 4. Destructive actions are one unconfirmed click

None of these ask, and none can be undone:

- **Remove** a project (`projects.vue`): loses the skill vocabulary and stops the
  workspace sweep. It sits in the same row as Save, with the same busy key.
- **Revoke** an API key (`AccessCard.vue`): a CI pipeline stops working.
- **Clear** a credential (`CredentialField.vue`): the deployment loses its host.
- **Finish without posting** (`AiReviewRunCard.vue`): discards an entire AI
  review, from a ghost button beside Post.
- **Dismiss** a finding: gone from the curation with no way back.
- **Withdraw** an ask: fine on its own, but the same button style as the rest.

**Recommend**: one `useConfirm` composable wrapping `UModal`, used by Remove,
Revoke, Clear and Finish. Dismiss can stay one click if a dismissed finding is
kept in a collapsed "Dismissed (3)" section with a Restore. Give destructive
buttons `color="error"` consistently (Remove has it, Revoke has it, Clear and
Finish do not).

### 5. The attention inbox lies when it fails, and Refresh does not refresh it

`useAttentionStream` records a failure in `error` (a 503 when the deployment
cannot say who is looking, or an event the contract does not describe) and empties
the list. `index.vue` never reads `attention.error`, so the inbox renders "Nobody
is waiting on a reviewer" over a fetch that failed. This is exactly the "screen
claimed its list was empty when it had simply failed to read it" case that
`ApiErrorAlert.vue`'s own comment was written to end.

Separately, the page's **Refresh** button calls the `refresh` from
`useAsyncData('workspace')`, which does not touch `attention.refresh`. The inbox
badge says "refresh to update" when the stream is down, and the button beside it
does not do that.

**Recommend**: render `ApiErrorAlert` (or an inline alert inside the card) from
`attention.error`, and have the page's Refresh await both refreshes.

### 6. A committed pull request appears in two lists

`workspace.ts:43-51` cuts `authored` and `reviewRequested` from what the host
returns and knows nothing about commitments. After "I will review it", the same
pull request stays under "Waiting on your review", still offering "I will review
it", and also appears under "You committed to reviewing". The person has acted
and the top list does not acknowledge it.

**Recommend**: pass the commitment ids into the cut (a pure function taking
`committedUrls`) and either drop committed rows from `reviewRequested` or mark
them "committed" with the button swapped for "Hand back".

### 7. Signed out, the landing page is an error with no door

On a `required` deployment with nobody signed in, `/` shows "This deployment
could not build your workspace" with the API's 401 text. The only sign-in button
is on Configuration, reached via the small "Not signed in" link at the foot of
the rail. The `app.vue` comment defends keeping the buttons on Configuration, but
the landing page is where an anonymous person arrives.

**Recommend**: a dedicated signed-out state on the workspace: one sentence and the
"Sign in with GitHub / GitLab" buttons (`auth.state.signInProviders` is already
loaded in the shell). Keep Configuration's copy for the admin view.

### 8. Raw enum values on screen

- `board.vue:127` renders `review.status` as-is: `in_review`, `changes_requested`.
- `reviewers.vue` renders `reviewer.availability` as `available` / `paused`.
- `AiReviewRunCard.vue` does `run.status.replace('_', ' ')`, which handles one
  underscore, and renders `curation.status` raw.
- `SlackWebhookService` replies `Handed … to cat-factory (requested).`

`vcsDisplayName` already sets the pattern for a contract-owned label. The status
vocabulary has none, so every surface improvises.

**Recommend**: `reviewStatusLabel`, `aiReviewStatusLabel`, `availabilityLabel` in
`@sainte-beuve/contracts`, used by the SPA, the Slack replies and the bot
comments.

### 9. The same screen has three names

The rail says **Board**, the page heading says **Reviews**, the README and the
Slack copy say "the board", and the empty state says "Nothing is being reviewed".
Configuration's subtitle and the Access card both say "this deployment" while the
member alert says "this org".

**Recommend**: pick "Board" for the screen (it matches the README and the
route), and use "reviews" only for the rows on it. Pick "deployment" or "org"
per audience and stick to it.

### 10. No loading state, and one false empty state

Every page `await`s `useAsyncData` at setup. With `ssr: false` that means the
previous page stays on screen, frozen, until the API answers, and a cold load
shows nothing at all. `pending` is only wired to the Refresh button's spinner.

`AiReviewPanel.vue` is `lazy`, which is right, but its template checks
`runs.length === 0` before `pending`, so opening a row shows "Nothing delegated
yet. Press AI review…" for the duration of the fetch, then replaces it with the
runs. On a slow cat-factory read that is long enough to be believed.

**Recommend**: `lazy: true` on the page reads with a skeleton (`USkeleton`) per
card, and a `v-if="pending && !data"` branch ahead of every empty state.

### 11. One request locks every control on Configuration

`configuration.vue` passes `:busy="busy !== null"` to each `VcsConnectionCard`
and `SlackConnectionCard`. Every button on every card shows a spinner while any
one call is in flight: saving the Slack token spins "Install the GitHub App".
The cards accept a boolean, so they cannot tell which of their own actions is
running either (Save and Clear in `CredentialField` share one `busy`).

**Recommend**: pass the key (`busy` as `string | null`) down and let each card
compare against its own action ids, the way the board and reviewers pages
already do per row.

### 12. Skills are free text in three places and matched exactly

Skills are an all-of gate, matched by string. They are typed as a comma-separated
box on the project row, in the reviewer form (add and edit), and via a label
prefix on GitHub; then picked from checkboxes in the ask modal. `Backend` on the
project and `backend` on the reviewer never meet, and nothing on any screen says
so. The reviewer form's description ("A review needs ALL of the skills") explains
the rule but not the vocabulary it should be drawn from.

**Recommend**: a tags input (`UInputTags` or `UInputMenu multiple`) seeded with
the union of every project's skills, so a reviewer's skills are chosen from what
an ask can actually request. Decide case handling in the contract (`skillSchema`
could normalise) and say it once. On the Reviewers screen, flag a skill nobody
can ask for and, on Projects, a skill nobody holds.

### 13. Disabled buttons with no reason, and no Enter on Add project

- **Add project**: the button is disabled until owner and repo are filled, with
  no message. Enter in the last field does nothing, unlike the credential
  inputs and the key label, which both submit on Enter.
- **Reviewer form**: Save is disabled when the weight is out of range, again
  silently. The description says "above 0" while the input's `min` is 0.1 and
  `max` is 10, so a typed 0.05 or 12 disables Save with no hint why.
- **Post N inline / Send to a fixer** are disabled at zero selected, which is
  right, but the footer text does not say so.

**Recommend**: `UFormField :error` on the offending field, and `@keyup.enter`
on the add-project inputs. Say the weight range in the description.

### 14. An unregistered project reads as one with no skills

`RequestAttentionModal.vue` finds the project by host, owner and repo. When the
pull request's repository is not registered at all, `skills` is empty and the
copy says "This project has no skill vocabulary. Add one on the Projects screen,
or ask everybody available." The real state is that nothing here knows this
repository, and the Projects screen link should say "Register it".

Also: "Only my team" is offered to a viewer with no team recorded; the
description says nobody without a team is in it, but does not say that includes
the person asking, whose ask would then reach nobody.

**Recommend**: distinguish `project === undefined` from `project.skills.length === 0`
in the copy, and disable "Only my team" with a reason when the viewer has no team
(the viewer's reviewer row is on `workspace.viewer`).

### 15. "Find a reviewer" succeeds silently

`board.vue:assign` toasts on shortfall and on error, and on success only
refreshes. The badge moves to "assigned" but nothing names who. The Slack
equivalent says "`owner/repo#7` now goes to Ada." and the bot comment on the
pull request names the reviewers too. The board is the one place that does not.

**Recommend**: a success toast with the names from `result.assigned`, and
finding 3 so the row keeps saying it afterwards.

### 16. A minted key cannot be copied and is easy to lose

`AccessCard.vue` shows the one-time key as a `UAlert` description with a close
button. Selecting text out of an alert is fiddly, there is no copy-to-clipboard,
and the close button clears it with no confirmation on a value the copy above it
says is unrecoverable.

**Recommend**: render the key in a `<code>` block with a Copy button that
confirms ("Copied"), and replace the close icon with an explicit "I have stored
it" button.

### 17. Nothing adapts below desktop width

The rail is a fixed `w-56`; inputs are `w-96`; the connection cards use
`grid-cols-[10rem_1fr]`; every list row puts three or four buttons in a
`shrink-0` cluster. Below roughly 900px the board row's actions overflow the
card, and the reviewer form's eleven fields wrap into a wall. The Slack nudge
that links to the board (finding 1) is read on a phone.

**Recommend**: collapse the rail to icons or a top bar under `md:`, make widths
`max-w-*` instead of fixed, and move per-row secondary actions into a
`UDropdownMenu` on narrow screens.

### 18. Copy written for the implementer, and some of it wrong

The tone is a strength on the whole: the screens explain why, not just what.
But several descriptions run to four sentences and read like the code comments
they sit beside:

- cat-factory card: ~70 words on `decide` scope, base URL and service id, in
  the field's own description.
- `VcsConnectionCard` header: "Where a review starts, and where the verdict has
  to land. Pick whichever way of connecting suits the deployment…"
- `AccessCard` open-mode alert names `AUTH_MODE=required` and an OAuth client to
  every viewer, including members who can change neither.
- Reviewer form, Availability: "Paused keeps the row and its skills, and signs
  them out." Nothing is signed out; they are taken out of selection.
- Reviewer form, Slack user id: "Where a reminder is delivered." The Slack reply
  copy says the id is also how `/review take` recognises them, which is the more
  common reason to fill it in.
- Board empty state: "Open a pull request, or register one through the API." A
  fresh deployment's real next step is a `needs-review` label or the webhook on
  Configuration.

**Recommend**: one sentence per description, with the rest behind a
`UCollapsible` "How this works" or a link to `docs/integrations.md`. Env-var
instructions only in the admin branch. Fix the two descriptions above.

### 19. Accessibility

- The finding checkboxes in `AiReviewRunCard.vue` have no label; a screen reader
  announces "checkbox" with nothing about which finding it selects. Pass
  `:aria-label="finding.title"` or wrap the title as the label.
- Status is carried by badge colour plus the raw value (finding 8). Fine once
  the label is readable; today "in_review" is read letter by letter.
- Title links open in a new tab (`target="_blank"`) with no visual or
  `aria` cue; the Review button beside them has the icon, the link does not.
- The one `aria-label` in the app is on the board's chevron; the icon-only
  Refresh buttons have text, which is good. Inline edit forms (`ReviewerForm`)
  do not move focus to their first field when opened.
- `<pre>` for `suggestedFix` has no `lang`, `tabindex` or wrapping, so a long
  line is a horizontal scroll a keyboard cannot reach.

### 20. Project skill edits have no dirty state

`projects.vue` keeps a `drafts` map but the row shows no sign that the draft
differs from the saved value; Save is always enabled; navigating away drops the
edit without a word. Save and Remove both use `busy === project.id`, so pressing
one spins both.

**Recommend**: enable Save only when `draftFor(project) !== project.skills.join(', ')`,
show a "Unsaved" hint, and key Remove separately (`${project.id}:remove`).

### 21. The board cannot change a review's status

`updateReviewStatusContract` exists and is mounted, but no screen calls it. A
review that was approved on the host before the webhook noticed, or one the host
never reports on (GitLab today), stays `open` for ever with no way to close it
from the UI. The Slack `/review` verbs have the same gap.

**Recommend**: a "Mark as…" dropdown on the row, admin only, at least for
`closed`.

### 22. No state in the URL, and no error page

Expanded board rows, the reviewer being edited, and the ask modal are all
component state. A reload loses them and none can be linked. There is no
`error.vue`, so a 404 (see finding 1) shows Nuxt's default with no rail.

**Recommend**: `?review=<id>` on the board (also solves finding 1) and a small
`error.vue` that keeps the shell and links to the workspace.

### 23. Slack details

- `/review take <id>` needs a review id copied out of `/review` (`rev-…`).
  The buttons on the announcement avoid this, but a reminder DM has no button,
  and reminders are where somebody most wants to act. Add the same three buttons
  to `reminderMessage`.
- "Snooze a day" on the button versus `[hours]` on the command is fine, but the
  snooze reply gives a timestamp with no timezone hint; Slack's `<!date^…>`
  token renders in the reader's zone.
- The `ai_review` reply echoes `run.status` raw (finding 8).

### 24. The connect toast re-fires on reload

`configuration.vue` toasts "GitHub connection updated" whenever
`?connected=github` is in the URL, and does not strip it. A reload, or a
bookmark, says the connection was just updated when it was not.

**Recommend**: `router.replace({ query: {} })` after the toast.

## Cross-cutting recommendations

Four changes cover most of the list, and each is a small module rather than a
sweep:

1. **Labels in the contract.** `reviewStatusLabel`, `aiReviewStatusLabel`,
   `availabilityLabel` and `boardReviewPath` next to `vcsDisplayName`, so the
   SPA, Slack and the bot comment read one table. Fixes 1, 8, 15, 23.
2. **A `useConfirm` composable** and a `color="error"` convention for anything
   that cannot be undone. Fixes 4.
3. **A page frame component** (heading, subtitle, Refresh, error alert, skeleton,
   empty state as slots). Five pages hand-roll the same header block today; one
   frame fixes 10 and makes 9 a single edit.
4. **Per-action busy keys everywhere**, passed as `string | null` rather than
   collapsed to a boolean at the page boundary. Fixes 11 and 20.

## What already works well

Worth keeping as the bar for the rest:

- Every failed read on a page goes through `ApiErrorAlert` with the API's own
  message. Only the attention inbox (finding 5) escaped it.
- Inputs are not cleared on a refused save (credentials, add project). Losing a
  pasted token to a 503 is a common failure elsewhere and it is handled here.
- The shortfall copy is one table shared by the toast and the bot comment, with
  a cause and a remedy per reason.
- The AI review card's post receipt says exactly what landed and what did not,
  against the attempt number, and re-posting skips what is already up.
- The Configuration screen reads the sign-in state first and on its own, so the
  sign-in button survives every other refusal on the page.
- Every Slack message sets `text`, so a phone notification reads as a sentence
  rather than "message".
