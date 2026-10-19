---
'@sainte-beuve/app': patch
---

The development-mode persona switch stays reachable.

The rail was as tall as the page, so its foot (the persona switch and who the
screens render for) sat at the bottom of the document: it showed while a screen
loaded and was pushed out of sight as soon as the data landed. The rail is now
sticky at the viewport's height. With `DEV_MODE=true` the header also carries a
flask button, in both the wide and the narrow layout, that opens the persona
switch in a dialog.
