---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

My PRs offers **Suggest reviewers** on each of your open pull requests that is out of draft. The
dialog lists the best matches, ranked by the same recommendation the attention dialog uses (the
repository's skills and domains, past reviews there, then load), with the top two ticked. You can
untick them, tick others, and search the directory for anybody the ranking left out. People who
already committed, were asked on an open ask, are requested on the host, or declined are shown as
such instead of offered again, and the author and bot accounts are never offered.

Asking goes through a named attention ask, so each person picked gets the ask in their inbox and a
Slack DM, and commits or declines from there. Asking again adds to your open ask on that pull
request instead of raising a second one, and nobody is asked twice.

- `POST /my-pull-requests/reviewer-suggestions` answers the ranking, the preselection, the rest of
  the directory and who is already on it.
- `POST /my-pull-requests/reviewer-asks` asks the people picked.
- Both re-read the pull request on its host and refuse one the caller did not open, as merging
  from My PRs does. That check is now shared (`readAuthored`).
- `planReviewerSuggestions`, `isBotReviewer` and `isBotLogin` are exported by
  `@sainte-beuve/reviewers`.
