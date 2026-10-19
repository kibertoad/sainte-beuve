---
'@sainte-beuve/contracts': minor
'@sainte-beuve/risk': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/server': minor
'@sainte-beuve/persistence-conformance': patch
'@sainte-beuve/app': minor
---

Act on a pull request the moment it opens as a non-draft or leaves draft. The risk
policy gains `autoAiReview`, which files cat-factory's AI review then, and `assess`
now also re-assesses a row the board already held when it leaves draft. Automatic
approval behind an AI review is held to cat-factory's own reviewer gate: nothing
at the blocking severity, and a rating (read off the findings) at or above the new
`minAiReviewRating`, 0.8 by default. The rating is kept on the assessment as
`aiReviewRating` and shown on the board badge, and an assessment adopts the review
filed on opening instead of filing a second. A `track` intake intent now says
whether the pull request just became `ready`.
