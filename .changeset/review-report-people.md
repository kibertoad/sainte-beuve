---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/integrations': minor
'@sainte-beuve/reporting': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

Reports list the people behind the reviews: for everybody who reviewed or
opened a pull request in the window, how many pull requests by others they
reviewed, approved and reviewed first, how many they opened, and the
milestones of the ones they opened, with the longest of those still waiting
for a human review. Names come from the Reviewers directory
where somebody holds the handle. `ReviewReport` gains `people`, and
`buildReviewReport` takes the directory.

`PullRequestTimeline` gains `authorBot`, read from both hosts, so a pull
request opened by a GitHub App or a GitLab bot user is not a person's.
