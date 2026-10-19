---
'@sainte-beuve/contracts': minor
'@sainte-beuve/reviewers': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

List a teammate's attention ask under My Reviews' "Asked to review".

An open ask that names the viewer, and that they have neither committed to nor
declined, now joins the host's review requests in `requested`, once per pull
request. Each `MyReview` row carries a new `ask` (the attention request's id,
who asked and their note), null when only the host is waiting. The page offers
the inbox's own "I will review it" and "Not me" on those rows, through the
existing attention routes, and a commitment moves the row to the committed list.
