---
'@sainte-beuve/app': patch
---

The AI review and guided review screens show their loading card while a pull request's
reviews are read, instead of the previous pull request's answer or the "nobody has asked
yet" empty state. "Start an AI review" waits for that read, so it can no longer file a
run on a pull request that already has one in flight.
