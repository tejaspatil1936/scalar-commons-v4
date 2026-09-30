# /observatory — the instruments

This directory is the client side of `/observatory`: one shared context and
one module per instrument, bundled by esbuild into `dist/observatory.js`.
The page frame (labels, sentences, empty reading slots, the upgrade rail and
the posture strip) is rendered at build time by `src/observatory.mjs`; the
design system is `src/observatory.css`. Nothing here ships a figure. Every
figure is fetched in the reader's browser.

## The three rules

1. **Provenance.** Every response is a *record* — `{ ok, at, label, link, raw,
   data | error, source }` — from `ctx.fetch`, `ctx.watch`, `ctx.watchAll` or
   `ctx.subscribe`. A figure is shown with `ctx.readout.showValue(target,
   record, …)`, which prints the endpoint and UTC time beneath it and links the
   figure to the raw bytes. Never show a number without the record it came from.
2. **No stale values.** A record with `ok: false` is handed to you the same way
   a success is. Call `ctx.readout.showError(target, record)` (or use
   `ctx.readout.apply`), which replaces the figure with *unavailable* and the
   reason. Never leave the previous figure standing, never substitute a zero.
3. **No guessed fields.** Read responses with `ctx.field(data, 'a.b.c')`, which
   throws on a missing key; `ctx.readout.apply(targets, record, render)` turns
   that throw into an *unavailable* reading. The test suite checks every
   `field(…, '…')` path against the indexer's source, so read only what
   `indexer/src/api.ts` and `chainState.ts` emit.

Two more, from the design brief: **nothing loops forever** (every tween runs
once; `ctx.motion.tween` is the only animation primitive, and it is a no-op
under `prefers-reduced-motion`), and **nothing runs while the tab is hidden**
(use `ctx.watch`/`ctx.watchAll`/`ctx.subscribe`, never `setInterval`).

## The contract

Each instrument is `src/observatory/instruments/<name>.js` exporting
`init(root, ctx)`, where `root` is its `<section data-instrument="<name>">`
and `ctx` is created by `context.js`:

| Member | What it is |
|---|---|
| `ctx.SOURCES` | every source, keyed by name — see `data.js` |
| `ctx.fetch(source)` | one HTTP or RPC read → record |
| `ctx.watch(name, handler, ms)` | poll `SOURCES[name]` every `ms`, shared with every other watcher; the handler gets the latest record immediately if one exists; returns a stop function |
| `ctx.watchAll(name, handler, ms, { maxPages })` | the same for a list endpoint read whole: the record has `items`, `total`, `complete` |
| `ctx.fetchAll(source, { maxPages })` | one whole-list read |
| `ctx.subscribe(name, handler)` | a pushed source (`newHeads`, `finalizedHeads`); the hero owns these |
| `ctx.bus.on(event, fn)` | page events: `head` `{ record, number, header, author: { kind, authorityIndex, slot } \| null, forked, arrivedAt }` (in the polling fallback `header` and `author` are null and `number` may be), `finalized` `{ record, number }`, `cadence` `{ perMinute, intervalMs, blocks, record }`, `socket` `{ state, detail, attempts }` (`state` is `open` \| `closed` \| `failed`; `attempts` is the reconnect count, and the status bar reads it to tell a first drop from a give-up), `visibility` `{ hidden }`, `theme` `{ dark }` |
| `ctx.reading(key, root)` | the `[data-reading=key]` element |
| `ctx.readout` | `showValue`, `showError`, `showAbsent`, `apply`, `provenance`, `rawLink` — see `readout.js` |
| `ctx.format` | `formatInteger`, `formatDuration`, `formatCmn`, `cmnNumber`, `shortAddress`, `shortHash`, `utcTime`, `relativeTime` |
| `ctx.motion` | `reduced()`, `tween(ms, frame, { ease, done })` → cancel |
| `ctx.theme` | `color('live' \| 'settled' \| 'active' \| 'disputed' \| 'slashed' \| 'text' \| 'text-dim' \| 'border' \| 'grid' \| 'bg')`, `font('mono' \| 'serif' \| 'sans')`, `isDark()` — read at draw time; re-read on the `theme` event |
| `ctx.fitCanvas(canvas, onResize)` | sizes a canvas to its CSS box at device resolution; returns `() => { context, width, height, dpr }` |
| `ctx.history`, `ctx.posture` | the two checked-in records embedded in the page |
| `ctx.announce(text)` | polite screen-reader status |
| `ctx.EXPLORER_ORIGIN` | `https://explorer.scalarnet.io` — agent links go to `/activity?agent=<address>`, validators to `/account/<address>` |

An instrument owns exactly three files: `instruments/<name>.js`,
`instruments/<name>.css` (appended to the shipped stylesheet after the design
system; use only its tokens, never redefine `:root`) and
`test/instruments/<name>.test.mjs` (pure functions, `node --test`). It never
edits `context.js`, `data.js`, `readout.js`, `observatory.mjs` or
`observatory.css`; if it needs a change there, it says so in its report.

`statusbar.js`, beside the instruments, is not one: it fills the one line at
the top of the page from the hero's bus events and the ring's validator read,
and fetches nothing of its own.

## Developing one instrument

```sh
node scripts/dev-instrument.mjs era --no-serve --out /tmp/h-era   # build the harness
node --test test/instruments/era-dial.test.mjs                   # its unit tests
```

The harness page is the instrument's own section on the real stylesheet,
booted against the live services. Screenshot it (both schemes, both widths)
with the Playwright script the session provides; look at the result before
calling the instrument done.

## The plate, in one paragraph

Deep plate-black (`--bg`) with a hairline reticle behind each instrument
(`--grid`); paper and ink in light mode. Instrument Serif for the large
numerals inside an instrument (`--font-serif`), IBM Plex Mono with tabular
lining figures for every readout and label (`--font-mono`), Source Sans 3 for
sentences. The accent (`--live`) is for live data only; `--settled`,
`--active`, `--disputed`, `--slashed` are the four states. Hairlines (1 px),
dots and type. No gradients, no shadows, no rounded pills, no icons, no
decoration. A reader who does not know what a block is must be able to read
the instrument from its sentence and its labels alone.
