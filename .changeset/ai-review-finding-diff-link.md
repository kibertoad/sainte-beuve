---
'@sainte-beuve/app': patch
---

Each AI review finding has a link next to its `path:line` that opens the pull request's changed
files at that spot in a new tab. On GitHub it lands on the line, on the side of the diff the
finding names. On GitLab it lands on the file: a merge request's line anchor needs the old and the
new line number, and a finding carries only one.
