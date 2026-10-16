---
'@sainte-beuve/contracts': minor
'@sainte-beuve/kernel': minor
'@sainte-beuve/ai-review': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

AI reviews can run on a person's own model subscription in cat-factory. Each person stores a
cat-factory key they minted as themselves (`/me/cat-factory/key`, and a "Your cat-factory key"
card), and their personal password travels as `X-Personal-Password` on the calls that file or
answer a review, never stored. The org learns once, from cat-factory refusing its own key with
`individual_model_unsupported` or `providers_unconfigured`, that its reviews need this; after that
they go straight through the person's key, and a call missing the key or the password is refused
before reaching cat-factory with `details.reason: cat_factory_personal_route`. The SPA prompts for
what is missing, caches the password for 40 hours, and retries. Saving the cat-factory settings
forgets what was learned; moving to another instance drops every personal key.
