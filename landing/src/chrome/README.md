# landing/src/chrome — Nightwatch

The one visual system for the landing pages, the Observatory and Pulse bundles,
the docs theme and the explorer. `tokens.css` is the single source of every
colour, face, size and timing; `chrome.css` draws every component from them
and nothing else; `print.css` is the only second face. `templates.mjs` renders
the components as strings (no DOM, no clock); `behaviour/` holds the small
modules that make them move, and only in response to the chain or a person.

Shared without a monorepo: `node scripts/sync-chrome.mjs` copies the three
stylesheets and the two font files into `docs/.vitepress/theme/chrome/` and
`explorer/src/chrome/`; `--check` (and `test/chrome.test.mjs`) fails when a
copy differs from the source by a byte. Font URLs are relative (`fonts/…`), so
every consumer serves the font files beside the stylesheet's URL.

## Rules the tests hold

- A `Reading` without a `source` (`{method, url, fetchedAt, block, raw}`)
  throws at render time: the build fails rather than ship a figure with no
  origin. Live pages pass the declared endpoint and fill `fetchedAt`/`block`
  in the browser.
- `chrome.css` uses only tokens: no hex colour, no `font-size` outside the
  scale, a `border` only on the focus ring, a stub's perforation and a code
  block's inset. The one gradient is the Curve's pooled light (in the SVG) and
  the dotted leaders' `radial-gradient` dots.
- Filament is for what is live now; a record is sage; each state colour is
  paired with its word (`STATE_WORDS`).
- One loop: the loading leader (`nw-travel`), only while loading, and the
  word "loading" under reduced motion.

## Asking for a change

Only the main thread edits this directory. A page that needs a rule the chrome
lacks writes it to `requests/<phase>.css` with a comment saying why; it is
merged into `chrome.css` by hand and the request file deleted.
