# Round 2 — the Ledger: monochrome classic re-skin, alignment contract, live-data fixes

Branch `ccr-784bdeb4-ol0ld0` (PR #306). Everything in `SCALAR-SITE-REVAMP.md` still applies — the honesty rules, the data rules, the pages and their copy, the components and their behaviour, no CI/CD, evidence for every claim — **except the visual system in its §2**, which this file replaces. Read both files from disk. Time box: 2 hours. Do not stop for questions; decide per the two files and log decisions in the PR.

## 1. The visual system: the Ledger

**Concept.** Black ink on paper. The site is a printed ledger of a running chain: a serif for every word, a monospace for every figure, hairline rules between rows, dotted leaders from label to value, generous margins, numbered sections. Nothing is coloured. State is carried by ink weight, outline, hatching and the word beside it — never by hue. Liveness is the only motion: a figure that just changed is printed black and fades to grey as it ages, like ink drying.

### 1.1 Tokens — replace `landing/src/chrome/tokens.css` with exactly this set

```css
:root {
  /* paper */
  --paper:   #fcfcfc;  /* page */
  --paper-2: #f4f4f4;  /* sheet, band, code */
  --paper-3: #ebebeb;  /* field, pressed, selected */
  /* ink */
  --ink:   #111111;    /* text, figures, live marks        18.4:1 on paper, 15.8:1 on paper-3 */
  --ink-2: #4d4d4d;    /* secondary text                    8.2:1 on paper, 7.1:1 on paper-3 */
  --ink-3: #6f6f6f;    /* labels, captions, settled marks   4.9:1 on paper, 4.6:1 on paper-2; never as text on paper-3 (4.2:1) — use ink-2 there */
  --rule:  #d6d6d6;    /* hairlines, leaders, rails */
  --rule-2:#b0b0b0;    /* stronger rules, outlines */
  /* type — two families only */
  --font-serif: "Source Serif 4", Georgia, serif;
  --font-mono:  "IBM Plex Mono", ui-monospace, monospace;
  --display: 600 4.5rem/1.05 var(--font-serif);   /* 72 px, letter-spacing -0.015em */
  --h2:      600 2.25rem/1.15 var(--font-serif);  /* 36 px */
  --h3:      600 1.375rem/1.3 var(--font-serif);  /* 22 px */
  --body:    400 1.125rem/1.6 var(--font-serif);  /* 18 px, measure 62ch */
  --small:   400 0.9375rem/1.5 var(--font-serif); /* 15 px */
  --figure-xl: 400 4rem/1 var(--font-mono);       /* 64 px */
  --figure-l:  400 2.75rem/1 var(--font-mono);    /* 44 px */
  --figure-m:  400 1.75rem/1 var(--font-mono);    /* 28 px */
  --figure-s:  400 1.25rem/1 var(--font-mono);    /* 20 px */
  --label:   500 0.6875rem/1 var(--font-mono);    /* 11 px, uppercase, letter-spacing +0.12em */
  --mono:    400 0.8125rem/1.5 var(--font-mono);  /* 13 px */
  /* geometry */
  --radius: 2px;
  --bar: 72px;
  --content: 1200px;
  --gutter: 24px;
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px;
  --s-7: 48px; --s-8: 64px; --s-9: 96px; --s-10: 160px;
  /* motion (unchanged semantics: fast attack, long cool) */
  --t-attack: 120ms; --t-cool: 1800ms; --t-ui: 240ms; --t-shift: 240ms;
  --ease-attack: cubic-bezier(0.1, 0.9, 0.2, 1);
  --ease-cool: cubic-bezier(0.2, 0.6, 0.4, 1);
  --ease-ui: cubic-bezier(0.2, 0, 0, 1);
}
```

No other colour value may appear anywhere in `chrome.css`, the page stylesheets, the instruments or the explorer and docs copies: extend `test/chrome.test.mjs` so that every hex, rgb or hsl literal outside `tokens.css` fails the test, and so that the five ink/paper pairs above pass the contrast figures given (the contrast helper already exists). Filament, vermilion, ice, clay and the pines are gone — delete them, do not alias them.

**Fonts.** `@fontsource-variable/source-serif-4` (opsz axis on; weights 400 and 600) and `@fontsource/ibm-plex-mono` (400 and 500), self-hosted through the existing build step, `font-display: swap`, `font-variant-numeric: tabular-nums lining-nums` on every figure, `font-optical-sizing: auto`. Nothing else ships; drop the Instrument Sans and Martian Mono files.

**One theme, light.** No dark scheme, no switch. Print is the same page without the bar.

### 1.2 What each component becomes

| Component | In the Ledger |
|---|---|
| Rules | Allowed, and the main structure: 1 px `--rule` between every row of a ledger, under the top bar when scrolled, above the footer. Never a box: a rule is a line, not a frame. No cards, no borders around groups |
| Leader | 2 px dots, 6 px pitch, `--rule-2`; hover `--ink` |
| Reading | label `--label` `--ink-3` · leader · figure `--ink` · stub · receipt line `--mono` `--ink-3`. Live figures are `--ink`; record figures (as-built, from a file) are `--ink-2` |
| Stub (20×28 tab, perforated left edge) | live: solid `--ink` · record: `--rule-2` outline, paper fill · in dispute: diagonal hatch (45°, 1 px `--ink` lines at 4 px pitch) · slashed: outline with an X · operator-run: double outline (1 px, 2 px gap) · sealed record: outline with a solid perforation. Every stub still tears open into the receipt panel on `--paper-2` |
| Tag | `--label` on `--paper-2`, 2 px radius; the state word always present (`LIVE`, `SETTLED`, `IN DISPUTE`, `SLASHED`, `OPERATOR-RUN`, `AS BUILT · <UTC>`); before the word a 6 px mark in the stub's language (solid, outline, hatch, X, double ring) |
| Lamp | 8 px `--ink` dot; on each new block a 1 px ring expands from 8 px to 24 px and fades over `--t-cool` (the only "glow"); unlit = `--rule-2` outline; stalled and index-behind add the word in `--ink` weight 500 |
| Live figure change | the changed digits print `--ink` at weight 500 and settle to weight 400 over `--t-cool`; nothing else moves |
| Button / Quiet / Field | Button: `--ink` fill, paper text, `--label`; hover `--ink-2`; disabled `--rule-2`. Quiet: `--mono` with a dotted underline. Field: `--paper-3`, 1 px `--rule-2` bottom rule only, focus rule `--ink` 2 px |
| Ledger rows | 48 px rows, 1 px `--rule` between, hover `--paper-2`, selected `--paper-3` |
| Rail / Spine | 1 px dotted `--rule-2` rail; ticks `--ink-3`; the newest tick `--ink` 2 px with the lamp's ring; finalized ticks `--rule-2` |
| River | 3 px bars, `--ink-3`; the newest `--ink`; the FINAL marker a 1 px `--ink` rule with its label |
| Day Bar | settled segments `--rule-2`, the current fill `--ink`, labels `--label` |
| Ember / EmberBank | 24×3 px bars, `--ink` at the multiplier's opacity on `--paper-2`; dispute = hatched; slashed = X; operator-run = a 1 px tick at the left |
| Waterfall | paper field; agreement = 1 px `--ink` line with end ticks; message = 4×4 `--ink-3` cell with a 1 px `--rule-2` line; paid = 4×6 `--ink` cell, line `--ink-3`; dispute = 1 px hatched line (dashes 2/2) repeated down the rows; oracle = 1×12 tick; joined = head printed `--ink` |
| Curve | 1.5 px `--ink` line, a flat 8 % `--ink` fill beneath (no gradient anywhere on the site now), three `--label` values at the left, a 6 px `--ink` end dot, event ticks on the baseline as hatch (dispute) or X (slash) with the word beside them |
| Redaction | solid `--ink` bar over sealed text, `no key held` inside in paper; lifted = `--ink` at 25 % raised 8 px; hash-only = the 32×2 grid in `--ink` and `--rule-2` |
| Code | `--paper-2`, `--mono`, keywords weight 500 (no colour), Copy top-right |
| Top bar | 72 px, paper, a 1 px `--rule` under it once scrolled; wordmark in Source Serif 4 600 20 px; nav `--label`; the current page underlined 1 px `--ink`; the lamp; Sources + switch (ink knob); ⌘K tag; Present on the Observatory only |
| Footer | `--paper-2`, 1 px `--rule` above, the three link columns in `--mono`, the record lines right, the disclaimer in `--small` `--ink-2` |

## 2. The alignment and spacing contract (enforced)

1. **One spacing scale.** Every margin, padding, gap, row height and section space is one of `--s-1 … --s-10`. Add to `test/chrome.test.mjs` a check that every `margin`, `padding`, `gap`, `top/right/bottom/left`, `row-gap`, `column-gap` and `height` value in `chrome.css`, `observatory.css`, `pulse.css`, `faucet.css`, `oversight.css`, the docs theme CSS and the explorer's CSS is `0`, `auto`, `100%`, a `var(--s-n)`, or a `calc()` of those. No bare pixel values.
2. **One type scale.** Every `font` or `font-size` in the same files is one of the eleven tokens. The test already asserting a closed set of sizes is updated to this set.
3. **The grid.** 12 columns, 24 px gutters, 1200 px, centred. Every block starts and ends on a column line. The top bar is on the same grid: wordmark in columns 1–2, nav 3–7, lamp 8–10, controls 11–12.
4. **Vertical rhythm.** Body 18/28.8 → set the baseline to 8 px: every block's height and every vertical space is a multiple of 8 (the scale guarantees it). Sections are separated by `--s-10`; a section's eyebrow, heading and first row are `--s-4`, `--s-6` apart; rows inside a ledger are 48 px (`--s-7`) tall.
5. **Figures never collide and never wrap.** A row of Readings uses one figure size, chosen by the count in the row: 1 → `--figure-xl`, 2 → `--figure-l`, 3–4 → `--figure-m`, 5–6 → `--figure-s`. Figures are `white-space: nowrap` with `min-width: 0` on their columns; when a figure would still exceed its column (measured at render by `check-layout.mjs`, below), the row drops one size step for all its figures. Units (`CMN`, `blocks`) sit on the figure's baseline at `--label` size, 8 px after the figure, and the stub 8 px after the unit. Labels sit above figures, never beside them. On the home page the hero's three Readings are one column of three rows, each row 2 figures wide at most.
6. **Alignment.** In a row, labels share a top line and figures share a baseline; stubs are vertically centred on the figure's x-height; leaders end 12 px before the figure. Section numbers (`01`) sit on the heading's baseline. Tags and buttons are 32 px tall and align to the row they sit in.
7. **Mobile (≤ 480 px).** Single column, 20 px gutters, every figure one size step down, rows stack with `--s-5` between, the bar 64 px with the nav as a 36 px scrolling row; no page may scroll horizontally.
8. **The check.** Write `landing/scripts/check-layout.mjs` (Playwright; it is available in this session; do not add it to `package.json`): serve `dist/` and the docs build, start the explorer against `wss://rpc.scalarnet.io`, open every page at 1440 and 390, wait 10 s so live figures are present, then fail if (a) any two sibling Readings' bounding boxes intersect, (b) any figure's box is wider than its column, (c) `document.scrollWidth` exceeds the viewport, (d) any `font-size` or spacing computed on a `.reading`, `.ledger` or `.bar` element is not on the scales, or (e) any computed `color`/`background-color` is not one of the seven tokens. Print the violations with the page, the selector and the numbers. Run it after every phase and paste its output; it must be clean before the PR body is updated.

## 3. Faults seen with live data at 1440 (your renders had empty slots; these appear only with real figures)

1. Observatory 01 Chain and 02 Economy: four 72 px figures overlap ("1,162,798" into "1,162,796"; "about 2 h 53 min" into "3,029,534 CMN"). Contract §2.5 fixes the sizing; also shorten "about 2 h 53 min" to `2 h 53 min` and move "about" to the receipt.
2. Observatory: the river is drawn twice (under the hero and again in 01 Chain). Keep the hero one.
3. Observatory bar: the lamp text clips ("BLOCK 1,162,798 · F…"). Format: `block 1,162,798 · fin 2`.
4. Observatory validators list: no space after the address ("5Ck5…EAPTnot seen").
5. Observatory at 390: `scrollWidth` is 631 px. Find the element; the check in §2.8 must catch it.
6. Home hero: the Era reading overflows its column and pushes the stub out. Format `172 · 311 / 3,600` and apply §2.5.
7. Home 02: "100,000,000,000 CMN" wraps into three lines. Five in a row → `--figure-s`, nowrap; the full figure stays in the receipt.
8. Home 01: "1 calls ›" → "1 call ›". Home river: the FINAL label clips at the right edge.
9. Explorer home: Era, Session and Issuance wrap; the Spine column truncates block numbers. Widen the Spine column to four full columns and apply §2.5.

## 4. Then the not-done list, in this order

EmberBank · per-digit weight change on live figures · Spine author and shift motion · lamp index-behind state · History curves · comb Spine · explorer DECAYED tag, per-kind glyphs, the plain extrinsic sentence · docs standfirsts and the three 404 Readings · explorer earnings all-time and by era · docs code-block variables. The faucet form stays closed until the faucet vhost sends CORS headers; write the exact nginx lines into the PR notes for the operator.

## 5. Order, evidence, done

1. `site: ledger tokens and fonts` — §1.1, the colour-literal test, the spacing and type-scale tests (red first, then green).
2. `site: ledger components` — §1.2 across the chrome and every page; `sync-chrome` copies; every existing test green.
3. `site: alignment contract` — §2 applied page by page; `check-layout.mjs` clean at 1440 and 390 for home, observatory, pulse, faucet, oversight, 404, docs home, one docs article, explorer home, one block, one extrinsic, one account.
4. `site: live-data fixes` — §3 (most will already be fixed by §2; verify each one by rendering).
5. The not-done list (§4), one commit each, as far as the time allows.
6. Push, update the PR body (theme change explained in one paragraph; fixed / still not done; the check's final output; the CORS lines), final report with the measurements.

Done means: no colour literal outside `tokens.css`; no spacing or font size off the scales; `check-layout.mjs` clean on every page at both widths with live figures present; every test green; the PR body current.
