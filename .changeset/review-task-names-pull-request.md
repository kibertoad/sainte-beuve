---
'@sainte-beuve/ai-review': patch
---

An AI review task names its pull request in the task fields (`prNumber`, `prUrl`), as a conflict
resolution task already did. cat-factory's input gate stopped every review before its first step
with "No pull request to review", because it reads the target from the fields and the pull request
was only in the description.
