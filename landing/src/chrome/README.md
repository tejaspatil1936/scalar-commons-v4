# landing/src/chrome — the shared chrome

One light design system for the landing site, the explorer and the docs
theme (SITE-REDESIGN.md §2–§3). `tokens.css` holds the only colours, sizes,
spacing steps and radii; `fonts.css` the two self-hosted faces (Inter,
JetBrains Mono); `chrome.css` every component; `templates.mjs` the same
components as string templates (no DOM, no clock); `behaviour/` the one
shared behaviour (copy buttons). The header menu is a native `<details>`,
so it works on pages that ship no script.

`node scripts/sync-chrome.mjs` copies the three sheets and the two font
files into `docs/.vitepress/theme/chrome/` and `explorer/src/chrome/`;
`--check` and `test/chrome.test.mjs` fail when a copy drifts.
`explorer/src/chrome-templates.ts` mirrors `templates.mjs` (same markup,
same class names).

Rules the tests hold: colours only from the token list; no uppercase and
no letter-spacing except the display headline; every margin, padding and
gap on the 4–96 px scale; every font one of the ten type tokens;
`scripts/check-layout.mjs` holds the rendered pages to the same with live
data at 1440 and 390 px.
