---
'@sainte-beuve/server': patch
---

The cat-factory push warning says that `API_BASE_URL` is a server environment
variable, not a setting on the Configuration screen, and that changing it needs a
restart. An `http` `API_BASE_URL` (a laptop's `http://localhost:8788`) now gets the
same explanation instead of a registration cat-factory would refuse, since
cat-factory pushes only to https.
