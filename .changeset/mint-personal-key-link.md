---
'@sainte-beuve/contracts': minor
'@sainte-beuve/server': minor
'@sainte-beuve/app': minor
---

"Your cat-factory key" offers a "Mint a key in cat-factory" button, a deep link
(`?newApiKey=1&label=sainte-beuve&scope=decide&runsAsSelf=1`) that opens cat-factory's API tokens
window filled in for the key a personal subscription needs. `GET /me/cat-factory` carries it as
`mintKeyUrl`, built on the org's app URL. Storing a key now refuses anything that does not start
with `cf_live_`, so a personal password typed into the key field is caught with a message saying
where the password goes.
