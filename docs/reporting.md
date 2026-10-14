# Reports and review metrics

**Reports** shows how long pull requests wait at each step of review, across
every linked repository or in one of them. The same numbers can be pushed to an
OpenTelemetry collector, so a dashboard or an alert can watch them.

## What is measured

A report covers the pull requests opened in a window (7, 14, 30 or 90 days).
Each one is timed from the moment it was ready for review: when it was opened,
or when it last left draft. Pull requests still in draft are left out.

| Milestone          | When it is reached                                        |
| ------------------ | --------------------------------------------------------- |
| First review       | The first review by anybody but the author, bots included |
| First human review | The same, with bots and AI reviewers left out             |
| Approval           | The first approval by anybody but the author              |
| Merge              | The merge                                                 |

For each milestone a report gives the median, the p90 and the mean over the
pull requests that reached it, and counts the open ones still waiting on it
separately. A closed pull request that never reached a milestone counts towards
neither. The durations alone would read faster than reality whenever the slowest
pull requests have not finished yet, which is why the waiting count sits beside
them.

A review counts as automated when the host marks the account as a machine (a
GitHub App, a GitLab bot user), when its login ends in `[bot]`, or when it is one
of the review bots and AI reviewers listed in `KNOWN_AUTOMATED_REVIEWERS` in
`@sainte-beuve/reporting` (CodeRabbit, Copilot, Gemini Code Assist, Sourcery,
Qodo, Greptile, Ellipsis, Cursor's Bugbot and others). The author's own reviews
never count, since a reply on your own pull request is a review on GitHub.

### Where the numbers come from

Everything is read from the hosts when the report is asked for: nothing is
stored, so a report covers history from before the deployment tracked anything.

- **GitHub**: one GraphQL page of fifty pull requests at a time, newest first,
  with their submitted reviews and their last ready-for-review event, until the
  page that reaches past the window. A dismissed review counts as what it was
  when it was given, so an approval a later push dismissed still times the
  approval.
- **GitLab**: merge requests created in the window, fifty to a page, with their
  notes. GitLab has no review object, so a comment by somebody else is a review,
  and approvals, change requests and readiness come from its system notes.

A read follows at most ten pages. A repository with more pull requests than that
in the window is flagged on the screen, and a shorter window covers it in full.

## Hotspots

An org-wide report names the repositories that stand out on a milestone, worst
first:

- **Slow**: at least three pull requests reached the milestone and their median
  is one and a half times the whole report's or more.
- **Stalled**: at least two open pull requests have waited for the milestone
  longer than the whole report's p90 (a day when nothing in the report reached
  it). A median over the pull requests that made it cannot show these.

A repository both slow and stalled on a milestone is reported stalled.

## OpenTelemetry export

Set an OTLP/HTTP endpoint and the deployment pushes every org's report over the
last 30 days as gauges, on its own clock: hourly by default, as the Worker's
second cron trigger and as `REVIEW_METRICS_INTERVAL_MS` on Node, where the first
pass runs at boot. It uses the
official OpenTelemetry JavaScript SDK (`@opentelemetry/sdk-metrics` and
`@opentelemetry/exporter-metrics-otlp-http`), which sends over `fetch` in the
Worker's bundle and over `node:http` on Node.

| Variable                                                           | Meaning                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`                              | The full metrics URL, taken as written                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                      | The collector's root; `/v1/metrics` is appended            |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS`, `OTEL_EXPORTER_OTLP_HEADERS` | `key=value` pairs, comma-separated, values percent-decoded |
| `OTEL_SERVICE_NAME`                                                | `service.name` on the resource, `sainte-beuve` by default  |
| `REVIEW_METRICS_INTERVAL_MS` (Node)                                | How often the export runs, an hour by default              |
| `REVIEW_METRICS_CRON` (Worker)                                     | Which cron trigger runs the export, `0 * * * *` by default |

With no endpoint set the export does nothing. `/health` reports
`reviewMetricsExport` either way.

### Metrics

| Name                                             | Unit             | Value                                                                   |
| ------------------------------------------------ | ---------------- | ----------------------------------------------------------------------- |
| `sainte_beuve.review.time_to_first_review`       | `s`              | One point per `sainte_beuve.statistic`: p50, p90, mean                  |
| `sainte_beuve.review.time_to_first_human_review` | `s`              | The same                                                                |
| `sainte_beuve.review.time_to_approval`           | `s`              | The same                                                                |
| `sainte_beuve.review.time_to_merge`              | `s`              | The same                                                                |
| `sainte_beuve.review.pull_requests`              | `{pull_request}` | Per `sainte_beuve.review.milestone` and `.state` (`reached`, `waiting`) |
| `sainte_beuve.review.hotspot`                    |                  | 1 per repository and milestone named a hotspot                          |

Every point carries `sainte_beuve.org` (the org's slug),
`sainte_beuve.report.window_days` and `sainte_beuve.report.scope`. A point with
scope `org` is the whole org; a point with scope `repository` also carries
`vcs.provider.name`, `vcs.owner.name` and `vcs.repository.name`. A hotspot point
carries `sainte_beuve.review.milestone` and `sainte_beuve.review.hotspot_reason`.

A statistic nothing reached is not exported rather than exported as zero, and
neither is a repository its host would not read on that pass. Each
pass builds its meter provider afresh, so a repository that is unlinked stops
being reported on the next pass.
