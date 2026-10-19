---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Refuse a review you were asked for, and draw the review buttons before the server answers.

`POST /my-reviews/decline` takes the host's review request back off the viewer and
declines every open ask on the pull request still waiting on them. The author hears
about the host half as a Slack DM when they have a Slack id here, and as a comment on
the pull request otherwise or when the DM fails. `ChatGateway` gains
`sendReviewDeclined` for that DM.

Every row of My Reviews' "Asked to review", and of the Workspace's "Waiting on your
review", now offers "Not me". "I will review it", "Not me", "Hand back" and withdrawing
an ask move the row at once and send the call behind it; a refusal puts the row back
and toasts the API's message with a retry.
