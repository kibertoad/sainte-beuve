---
'@sainte-beuve/server': patch
'@sainte-beuve/app': patch
---

The cat-factory sync says plainly what a missing `API_BASE_URL` means.

- The warning names `API_BASE_URL` as this deployment's own public address, separate
  from the cat-factory base URL, and says the repositories and people still synced.
- The card's warning reads "The last sync reported a problem", since a push that
  cannot be registered does not stop the sync.
- Sync now registers the webhook only after the sync succeeds, so a failed sync's
  error is no longer replaced by the webhook's.
