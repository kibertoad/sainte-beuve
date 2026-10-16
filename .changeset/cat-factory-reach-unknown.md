---
'@sainte-beuve/ai-review': patch
---

A snapshot walk with a cat-factory key reaching several workspaces no longer fails on the reach
lookup. cat-factory's `/api/v1/me` refuses such a key unless a workspace is named, so the reach is
reported as unknown instead.
