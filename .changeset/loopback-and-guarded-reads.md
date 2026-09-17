---
'@sainte-beuve/server': patch
---

Close three holes in the origin rules the session cookie rides on.

- **Loopback is trusted only by a loopback deployment.** `http://localhost:<port>`
  was echoed BY NAME under the wildcard every facade ships, and the credentials
  header goes with a named origin — so a hosted deployment left on
  `CORS_ORIGINS = "*"` handed any page on the operator's machine a credentialed
  grant: a dev server, an installed app or a package's postinstall could read the
  board, mint an `sbk_` key and empty the project registry with the operator's own
  session. The echo is the whole of local development, so it stays, and now needs
  BOTH sides to be loopback: the origin and the one the browser addressed. An
  operator running the SPA locally against a hosted API lists that origin like any
  other.
- **The write guard refuses what the wildcard does not cover**, rather than unsafe
  methods alone. A GET is not always a read: answering one under `/ai-review`
  polls cat-factory with the deployment's key and writes what it learns onto the
  run, so CORS withholding the answer from a cross-site page left the spend
  already made. The guard now reads the same list CORS does — every unsafe method,
  the configuration routes, the AI-review routes — and lets a preflight through to
  the CORS layer that answers it.
- **`SameSite` is decided from every origin the deployment named, on the host the
  browser addressed.** It read `APP_BASE_URL` alone, so a split-host deployment
  that listed its SPA only in `CORS_ORIGINS` issued `SameSite=Lax` and had a
  sign-in that completed and a session never presented again — reported as
  "started in a different browser", which points at the browser rather than at the
  unset variable. It also compared against the URL this process was handed, so a
  single-host deployment behind a proxy that rewrites `Host` called itself
  cross-site and dropped `Lax` where `Lax` was right. Both now read the one list
  `withAppOrigin` already folds the two spellings into, against `X-Forwarded-Host`.
