# landing/src/chrome — the Ledger

The one visual system for the landing pages, the Observatory and Pulse bundles,
the docs theme and the explorer: black ink on paper, a printed ledger of a
running chain (SITE-ROUND2.md). `tokens.css` is the single source of every
colour, face, size, spacing step and timing; `chrome.css` draws every component
from them and nothing else; `print.css` is the same page without the bar.
`templates.mjs` renders the components as strings (no DOM, no clock);
`behaviour/` holds the small modules that make them move, and only in response
to the chain or a person.

Shared without a monorepo: `node scripts/sync-chrome.mjs` copies the three
stylesheets and the three font files (Source Serif 4, variable with optical
sizes; IBM Plex Mono 400 and 500) into `docs/.vitepress/theme/chrome/` and
`explorer/src/chrome/`; `--check` (and `test/chrome.test.mjs`) fails when a
copy differs from the source by a byte. Font URLs are relative (`fonts/…`), so
every consumer serves the font files beside the stylesheet's URL.

## Rules the tests hold

- A `Reading` without a `source` (`{method, url, fetchedAt, block, raw}`)
  throws at render time: the build fails rather than ship a figure with no
  origin. Live pages pass the declared endpoint and fill `fetchedAt`/`block`
  in the browser.
- Nothing is coloured. The palette is paper, paper-2, paper-3, ink, ink-2,
  ink-3, rule and rule-2, and no file outside `tokens.css` writes a hex,
  `rgb()` or `hsl()` literal — not the chrome, the page sheets, the
  instruments, the docs theme or the explorer. State is fill, outline, hatch
  and the word: live solid ink, record an outline, in dispute a 45° hatch,
  slashed an X, operator-run a double outline (`STATE_WORDS`).
- One spacing scale (`--s-1` … `--s-10`) and one type scale (eleven styles):
  every margin, padding, gap, offset and height, and every font, in every
  stylesheet of the site is on them (`test/chrome.test.mjs`).
- A rule is a line, never a frame: four-sided outlines exist only as marks
  (a stub, a tag's mark, the lamp, the switch) and the focus ring; the only
  gradients are the leaders' dots and the 45° hatch; no glow, no blur.
- A row of Readings (`.nw-row`) takes one figure size from how many share it
  (1 xl, 2 l, 3–4 m, 5–6 s); figures never wrap; `behaviour/fit.js` drops a
  row one step when a live figure outgrows its column.
- One loop: the loading leader (`nw-travel`), only while loading, and the
  word "loading" under reduced motion.

`scripts/check-layout.mjs` holds the rendered pages to the same contract with
live data at 1440 and 390 px (intersections, overflow, scroll, off-scale type
and spacing, non-token colours).

## Asking for a change

Only the main thread edits this directory. A page that needs a rule the chrome
lacks writes it to `requests/<area>.css` with a comment saying why; it is
merged into `chrome.css` by hand and the request file deleted.
