---
'@sainte-beuve/app': patch
---

AI review findings read less like a wall of text. A finding's body and its suggested fix render as
markdown (inline code, code blocks, lists, emphasis), built as Vue nodes so raw HTML in a finding
shows as text and a link keeps only a web URL. Each body opens on its first sentence, with a
**Show more** toggle for the rest and for the fix. The fix sits under a **Suggested fix** label and
wraps long lines instead of scrolling sideways.
