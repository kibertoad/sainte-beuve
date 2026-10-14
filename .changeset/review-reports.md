---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/reporting': minor
'@sainte-beuve/telemetry': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/app': minor
---

Reports: how long pull requests wait for a first review, a first human review,
an approval and a merge, across the linked repositories or in one of them, with
the hotspots across an org. The same numbers are exported as OpenTelemetry
gauges.

- `GET /api/v1/reports/reviews?days=&projectId=` and the Reports screen.
- `VcsGateway.reviewTimelines(project, since)` on GitHub (reviews and
  ready-for-review events over GraphQL) and GitLab (comments, approval and
  readiness system notes).
- `@sainte-beuve/reporting`: milestones, statistics and hotspots, pure. Bots and
  known AI reviewers are left out of the first human review.
- `@sainte-beuve/telemetry`: the reports as gauges over the official
  OpenTelemetry SDK and its OTLP/HTTP exporter, configured with the standard
  `OTEL_EXPORTER_OTLP_*` variables. Hourly, on a second Worker cron trigger
  (`0 * * * *`, named by `REVIEW_METRICS_CRON`) and on
  `REVIEW_METRICS_INTERVAL_MS` on Node. `/health` reports `reviewMetricsExport`.
