---
'@sainte-beuve/local-server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Harden the integration credential store behind the Configuration screen.

- `SecretCipher` seals against a CONTEXT (the integration id) and stamps every
  envelope with an id for the key that sealed it. A sealed value moved onto another
  integration's row stops opening, and a status read compares key ids instead of
  decrypting, so rendering the screen never materialises a credential.
- `unreadable` carries WHY: `no_key`, `key_mismatch` or `corrupt`, each with the
  instruction that fixes it. A truncated envelope is refused on its segment sizes
  instead of reaching Web Crypto and being reported as a rotated key.
- A status carries `inUse`, so a stored token is not badged as a working integration
  while the gateway is still built from the environment.
- `/api/v1/settings` is excluded from the wildcard CORS default. A hosted deployment
  names its SPA origin in `CORS_ORIGINS` for the Configuration screen to work, and
  loopback passes for local mode; without that, any page an operator visited could
  preflight a write into the token store.
- 503 from the store distinguishes "no encryption key is configured" from "the key
  this deployment has was refused, because ...".
- Local mode generates its per-boot key even when a copied `.env` carries
  `SETTINGS_ENCRYPTION_KEY=` with no value, and the Worker builds one cipher per
  isolate rather than one per request.
- In the SPA: a failed save keeps the pasted token, a whitespace-only draft leaves
  Save disabled, an integration id the bundle does not know renders as itself rather
  than blanking the page, and both pages share one `useApiAction`.
