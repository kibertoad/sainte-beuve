---
'@sainte-beuve/server': patch
'@sainte-beuve/app': patch
---

A cat-factory key stored before the settings is usable and says what it waits for.

- Test connection uses the stored key when no base URL is saved yet. The key is
  bound to nothing until the first save, which binds it to whatever URL it names,
  so the check sends it nowhere a save could not.
- The key's badge reads "Stored, save the settings to use it" instead of "Stored,
  not in use" while the instance settings are missing.
- The scope step names `write` and `decide` apart: guided review needs `write`,
  AI review needs `decide`.
