---
'@sainte-beuve/contracts': minor
'@sainte-beuve/server': minor
'@sainte-beuve/worker': minor
'@sainte-beuve/node-server': minor
'@sainte-beuve/local-server': minor
'@sainte-beuve/app': minor
---

`DEV_MODE=true` lets a developer act as any person in the directory, to test
author and reviewer flows with one GitHub account. `POST /api/v1/dev/act-as`
issues a session for the chosen row while host calls keep using the deployment's
credential, and the navigation rail gains a persona switch that can also add a
persona. The auth state and `/health` report `devMode`. An unrecognised value,
or `true` beside a public origin, is a configuration error.
