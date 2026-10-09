---
'@sainte-beuve/app': patch
---

Every list shows a spinner while it loads. The first read showed nothing at all, because the screens waited for `data === null` and Nuxt 4 starts it as `undefined`, so Repositories and Reviewers said "nothing here yet" until the list arrived. The loading cards now render, with a spinner and "Loading…" above them, and a list that is already on screen shows "Updating…" while a filter change or Refresh reloads it. The board no longer reports a linked review as missing before the board has loaded.
