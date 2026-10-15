---
'@sainte-beuve/ai-review': patch
---

A request cat-factory refuses on validation now carries the fields it refused and
why, such as `url: The webhook endpoint must be an https:// URL`, instead of only
"Request failed validation".
