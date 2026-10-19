---
'@sainte-beuve/ai-review': patch
---

An AI review cat-factory's input gate is holding is stopped and reported failed with
the gate's reason, such as "the task names no pull request to review". The gate parks
the run before its first model call and waits for somebody to fix the task in
cat-factory, which nobody looking at sainte-beuve can do, and the run reported the
same `waiting_decision` as one with findings ready. It read as a review still working,
and every load of its review polled it again. A refused stop fails the poll, so the
next poll tries again rather than leaving a parked task behind.
