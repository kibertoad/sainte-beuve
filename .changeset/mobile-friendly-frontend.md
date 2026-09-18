---
'@sainte-beuve/app': minor
---

The screens work on a phone: the rail becomes a slideover, and every row that
put buttons beside text stacks below `sm`.

The SPA was laid out for one width. A 56-unit rail took a third of a 375px
screen before anything was rendered beside it, every list row was
`justify-between` with a `shrink-0` block of buttons on the right, and the
configuration screen held a 10rem label column with a webhook URL in the hundred
pixels left over. Nothing was unreachable, but reaching it meant scrolling
sideways past a title squeezed into two words, which is the state somebody is in
when they open the workspace from the phone the Slack nudge arrived on.

- **The rail is the one thing that changes SHAPE, and `lg` is the only
  breakpoint it uses.** Below it, the destinations move into a slideover behind a
  button on a sticky bar, because a rail that merely narrowed would still be a
  rail nobody had room for. The nav itself is one new `AppNavigation` component
  rendered in both places rather than copied into each: two copies drift the day
  a destination is added, and the drift would only show on a phone.
- **The slideover closes on NAVIGATION, not on the click.** Its items are a
  `UNavigationMenu` whose clicks the shell never sees, so a handler on the button
  would leave the menu open over the screen it just navigated to — which is the
  standard way a phone menu is got wrong. A watch on the route closes it whatever
  moved it, the browser's back button included.
- **Every list row is the same decision, made once per row.** Description above,
  actions below, side by side again at `sm`. That is the workspace's three lists,
  the attention inbox, the board, the reviewer directory, the project registry
  and each AI-review finding — all of which had the same `items-start
justify-between gap-4` and now have the same stacked form under it.
- **A title is clamped to two lines rather than truncated to one.** A pull
  request title cut at one line on a 375px screen is two words and an ellipsis,
  which is not enough to tell two of somebody's own branches apart.
- **A fixed width is a wide-screen width**: `w-96`, `w-36`, `w-32` and `w-24` are
  all `w-full sm:w-<n>` now, and the token, key-label and skills inputs fill the
  card on a phone instead of showing six characters of what was pasted into them.
- **The two "what the host has to be told" lists lose their label column below
  `sm`**, so the term sits above its definition, and the URLs in them break
  anywhere: a webhook URL is one unbroken token and was the single widest thing
  on the page.
- **`Refresh` stays beside its heading and stops shrinking.** It is narrow enough
  to sit there while the sentence under the title wraps around it; what it must
  not do is shrink, which is what turned the label into two lines of three
  characters. The reviewer screen's pair of buttons wraps instead, because two of
  them beside a heading leave the heading a third of the width.

No behaviour changed and no contract moved: this is the layout the same data was
already rendered in, made to survive a narrow viewport.
