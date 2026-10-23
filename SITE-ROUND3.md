# Round 3 — the Ledger goes dark, and the type gets big

Branch `ccr-784bdeb4-ol0ld0` (PR #306), on top of round 2 (fbcc263). Everything in `SITE-ROUND2.md` and `SCALAR-SITE-REVAMP.md` still applies — the monochrome rule, the alignment and spacing contract, `check-layout.mjs`, the honesty rules, no CI/CD. This file changes two things only: the palette is inverted to dark, and the type scale is one size larger. Time box: 60 minutes. No questions.

## 1. Dark, by default and only

Replace the seven paper/ink values in `landing/src/chrome/tokens.css` with these. Nothing else in the file changes except the type block in §2. The colour-literal test and the contrast test keep their jobs; update the expected pairs to the figures given here.

```css
  /* paper — now the night */
  --paper:   #0b0b0b;  /* page */
  --paper-2: #141414;  /* sheet, band, code */
  --paper-3: #1d1d1d;  /* field, pressed, selected */
  /* ink — now light */
  --ink:   #f2f2f2;    /* text, figures, live marks       17.6:1 on paper, 15.1:1 on paper-3 */
  --ink-2: #bdbdbd;    /* secondary text                  10.5:1 on paper,  9.0:1 on paper-3 */
  --ink-3: #8f8f8f;    /* labels, captions, settled marks  6.1:1 on paper,  5.2:1 on paper-3 */
  --rule:  #2a2a2a;    /* hairlines, leaders, rails */
  --rule-2:#3d3d3d;    /* stronger rules, outlines */
```

Rules for the inversion, so nothing reads wrong on black:

- `color-scheme: dark` on `:root` (round 2 set `light` in the explorer and docs copies — flip both), so form controls, scrollbars and the docs' built-in widgets follow.
- Every component rule that said "ink on paper" now means light on dark with the same token names; nothing is hard-coded, so this should be the token swap plus the exceptions below. Grep for `invert`, `mix-blend`, `opacity` on images and `filter` and remove anything that assumed a light page.
- Stubs: live = solid `--ink` (now white) · record = `--rule-2` outline · dispute = hatch in `--ink` · slashed = outline with an X · operator-run = double outline. Redactions are solid `--ink` bars with the words inside in `--paper`.
- The Curve's flat fill stays `--ink` at 8 %; the river, Spine, Waterfall and EmberBank use `--ink` for the newest/live marks and `--ink-3` for the rest, exactly as before.
- Code blocks: `--paper-2` background, `--ink` text, keywords weight 500 — no syntax colours (the colour test enforces it).
- The lamp's ring and the live-figure weight change are unchanged; they read better on dark.
- Print (`print.css`) stays light: it inverts the seven tokens back to round 2's values under `@media print`. That is the only place the light values survive.
- The OG/social preview image, favicon and any PNG/SVG in `landing/public` that carried the light palette are regenerated dark.

## 2. Big type

Replace the type block in `tokens.css` with this scale. The spacing scale, the figure-size-by-row-count rule and `check-layout.mjs` are unchanged and must stay clean — bigger figures will push some rows down one size step by the existing rule; that is intended.

```css
  --display: 600 6rem/1.0 var(--font-serif);     /* 96 px, letter-spacing -0.02em */
  --h2:      600 3rem/1.1 var(--font-serif);     /* 48 px */
  --h3:      600 1.75rem/1.25 var(--font-serif); /* 28 px */
  --body:    400 1.25rem/1.55 var(--font-serif); /* 20 px, measure 60ch */
  --small:   400 1.0625rem/1.5 var(--font-serif);/* 17 px */
  --figure-xl: 400 5rem/1 var(--font-mono);      /* 80 px */
  --figure-l:  400 3.5rem/1 var(--font-mono);    /* 56 px */
  --figure-m:  400 2.25rem/1 var(--font-mono);   /* 36 px */
  --figure-s:  400 1.5rem/1 var(--font-mono);    /* 24 px */
  --label:   500 0.75rem/1 var(--font-mono);     /* 12 px, uppercase, letter-spacing +0.12em */
  --mono:    400 0.9375rem/1.5 var(--font-mono); /* 15 px */
```

With the larger body, the reading measure stays 60ch, so the docs' reading column widens from 640 px to the width 60ch takes at 20 px (about 720 px); take it from the index column, not the margin. Headlines wrap to at most three lines at 1440; if a display heading would take four, drop it to `--h2` for that page and say so in the PR.

Mobile (≤ 480 px): every size one step down, as the contract already says; `--display` becomes `--h2` there, and `--figure-xl` becomes `--figure-l`. Nothing may scroll horizontally — the check enforces it.

## 3. Order, evidence, done

1. `site: ledger, dark` — §1, tests updated and green, `color-scheme` flipped in the explorer and docs copies, print still light.
2. `site: big type` — §2, then `check-layout.mjs` clean on all thirteen pages at 1440 and 390 with live data; paste its output.
3. Render home, observatory, explorer home and a docs article at 1440 and 390 and look at them before pushing; fix any heading that wraps to four lines or any figure the rule pushed below `--figure-s`.
4. Push, update PR #306's body (one paragraph: dark by default, bigger scale; the check output; anything still open from round 2 unchanged), final report with the measurements.

Done means: the seven dark tokens are the only colours on the site; the new scale is the only scale; the check is clean at both widths with live data; print is light; every test green.
