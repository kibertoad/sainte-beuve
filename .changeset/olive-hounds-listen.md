---
'@sainte-beuve/persistence-memory': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/app': minor
---

Add the Configuration screen, and the encrypted credential store behind it.

- The SPA moves to a side navigation (Reviews, Reviewers, Configuration) and gains a
  Configuration page whose one section, Integrations, holds the cat-factory API
  token.
- `GET /settings/integrations`, `PUT /settings/integrations/:id/token` and
  `DELETE /settings/integrations/:id/token`, contract-first like every other route.
  A token is write-only: what a caller reads back is whether one is stored, its last
  four characters, and when it changed.
- `SecretCipher` joins the kernel ports, with `WebCryptoSecretCipher` (AES-256-GCM
  over an HKDF-derived per-record key) implementing it on Web Crypto, so the same
  code runs on workerd and on Node. `Repositories` gains `integrationTokens`.
- Wired on all three facades from `SETTINGS_ENCRYPTION_KEY` and reported on
  `/health`. Without a key the screen refuses to store anything rather than writing a
  credential in the clear; local mode generates an ephemeral one at boot, because its
  store does not outlive the process either. A token sealed under a key that was
  since rotated reads back as `unreadable`, not as absent.
