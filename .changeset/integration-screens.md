---
'@sainte-beuve/app': minor
'@sainte-beuve/server': patch
---

Each integration is configured on its own screen.

- The Configuration screen keeps the Access card and lists the integrations (GitHub, GitLab, Slack, cat-factory) with their status. Each row opens that integration's screen at `/configuration/<integration>`.
- A connect round trip (a host sign-in or the GitHub App install) now returns to that host's screen, `/configuration/github` or `/configuration/gitlab`, instead of `/configuration`. The SPA forwards a return to `/configuration?connected=<host>` from an older backend to the same place.
