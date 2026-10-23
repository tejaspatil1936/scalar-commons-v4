# Scalar Commons — site revamp brief (run from a Claude Code session in `tejaspatil1936/scalar-commons-v4`)

You are rebuilding the public face of Scalar Commons — the landing site (`landing/`), the live instruments (`/observatory`, `/pulse`), the docs theme (`docs/`), the block explorer's HTML (`explorer/`), and a new faucet page — as **one visual system called Nightwatch**, specified in full below. The UI changes completely. The data, the honesty rules and the serving contract do not change at all.

Read this whole brief before touching a file. Then read `landing/README.md`, `landing/src/observatory/README.md`, `CLAUDE.md`, `deploy/public/redeploy-site.sh` and `deploy/public/nginx/scalar-commons.conf.template`. Work in plan mode first: produce a short plan that maps this brief onto the files you will touch, then execute it phase by phase (section 9).

## 0. Hard constraints

1. **No CI/CD.** Do not create, edit or delete anything under `.github/`. Do not add deploy scripts, timers, hooks, pre-commit, Husky, Playwright-in-CI or any automation. Do not touch anything under `deploy/` except the prose of `deploy/README.md` during the status sweep (§1b). The only automation that exists is on the host (`deploy/products/redeploy-on-merge.sh`, a timer that rebuilds `landing/` and `docs/` after a merge to master); you are building for it, not changing it.
2. **No framework migration.** The landing stays a dependency-free static build (`landing/scripts/build.mjs` → `render.mjs` + esbuild bundles). No Astro, no React, no Vue outside VitePress's own theme, no Tailwind, no PixiJS, no WebGL, no animation library. Where this brief's source material mentions Astro/React/Pixi, ignore it: this repo's constraints win.
3. **The honesty architecture stays and gets stricter.** `chain-facts.json`, `src/content.mjs` (no literal digits in prose; `{{path|filter}}` placeholders only), `src/source-claims.mjs`, `runtime-history.json`, `chain-events.json`, `public/posture.json`, and every data/honesty test in `landing/test/` keep working. No figure on any page is ever typed by hand. No string on any page is invented by you; every sentence comes from this brief, from `content.mjs`, or from the chain.
4. **Serving contract unchanged.** `npm run build` in `landing/` must still emit `index.html`, `styles.css`, `observatory.html`, `observatory.js`, `observatory-graph.js` (the network-graph bundle, kept, see §5.2), `observatory.css`, `pulse.html`, `pulse.js`, `pulse.css`, `fonts/`, `runtime-history.json`, `posture.json` into `$LANDING_OUT_DIR` (default `dist/`), plus the new `faucet.html`, `oversight.html` and `404.html`. nginx serves `/observatory`, `/pulse`, `/faucet`, `/oversight` through `try_files $uri $uri/ $uri.html =404`. Docs build with `DOCS_BASE=/docs/ npm run build` into `docs/.vitepress/dist`. The explorer stays a Node server (`explorer/dist/index.js`, port 8081); only its HTML/CSS layer changes.
5. **Network and the snapshot.** The committed `landing/chain-facts.json` is from spec 304 (block 433,638) and predates the `messages` pallet, so the home page in §5.1 cannot be built from it. Phase 0 (§1b) refreshes it: add `'messages'` to `CONSTANT_PALLETS` in `landing/scripts/fetch-chain-facts.mjs`, run `npm run fetch:chain-facts -- wss://rpc.scalarnet.io` (the public RPC), then `npm run verify:chain -- wss://rpc.scalarnet.io`, and commit the refreshed file (it must say spec 309). The same for `npm run fetch:chain-events` and, in `docs/`, `npm run snapshot:chain -- wss://rpc.scalarnet.io`. If the session cannot reach the RPC, stop and report it; never fabricate a value, never edit the JSON by hand, and never ship spec-309 claims over a spec-304 snapshot.
6. **Git.** Branch `site/nightwatch` off `master`. One commit per phase (§9), messages prefixed `site:`. Never push to master, never force-push. Finish by opening a pull request whose description contains the deploy notes from §9.
7. **Evidence.** After every phase run the commands in §8 and paste the real output into your progress notes. Never claim a test passed without showing it.

## 1. What exists (keep the mechanism, replace the skin)

| Path | What it is | What you do |
|---|---|---|
| `landing/scripts/build.mjs` | The build: renders `index.html` from `chain-facts.json` + `content.mjs`, copies fonts, esbuild-bundles observatory and pulse | Extend: new pages, new font files, one shared chrome stylesheet; keep `LANDING_OUT_DIR` |
| `landing/src/render.mjs`, `content.mjs`, `source-claims.mjs` | Pure `facts + content → HTML`; the words; the claim → file:line table | Rewrite `render.mjs` for the new layout; rewrite `content.mjs` to the copy in §5 (placeholders only); extend `source-claims.mjs` with the 16 rows in §7 |
| `landing/src/styles.css` | The landing's tokens and layout (dark + light schemes) | Replace with `src/chrome/tokens.css` + `src/chrome/chrome.css` + `src/chrome/print.css`; one theme only |
| `landing/src/observatory.mjs`, `observatory.css`, `src/observatory/*` | The live-instrument page: frame, data layer (`context.js`, `data.js`, `hour.js`, `readout.js`), instruments, Sources switch, presenter, reveal | Keep `context.js`, `data.js`, `hour.js`, `format.js`, `ss58.js`, `scale.js`, `sources.js`, `presenter.js` as the data and behaviour layer. Rewrite the frame and the instruments' drawing to Nightwatch (§5.2) |
| `landing/src/pulse.mjs`, `pulse.css`, `src/pulse/*` | The constellation: `model.js` (events → sentences, counters), `feed.js` (live feed), `graph.js` (force-graph canvas), `strip.js`, `ticker.js` | Keep `model.js`, `feed.js`, `strip.js`'s counting, `ticker.js`'s sentences. Replace `graph.js` with the Waterfall (§5.3). Drop `force-graph` and `gsap` from `package.json` once nothing imports them |
| `landing/test/*` | The honesty suite (`build`, `claims`), the observatory contract (`observatory.test.mjs`), the lib and pulse tests | Data/honesty tests: untouched and passing. Design-contract tests (`observatory.test.mjs` from "the top bar" to "identity", `pulse.test.mjs` layout tests): rewritten to the Nightwatch contract with the same discipline (closed type scale, self-hosted fonts only, contrast AA, no loops, reduced motion honoured, no invented strings). Never delete a test; replace its assertions |
| `docs/` | VitePress 1.6 with the default theme; `.chain/snapshot.json`; `scripts/check-chain-values.mjs` (drift lint) | Add a custom theme under `docs/.vitepress/theme/` that uses the shared chrome; keep every page, route and the lint |
| `explorer/src/render.ts` (`STYLES`, the HTML shell), `routes.ts`, `server.ts` | Server-rendered block / extrinsic / account / activity views | Replace the shell and `STYLES` with the chrome; keep every route, every data read and every test |
| `faucet/` | JSON API only: `POST /drip`, `GET /health`, `GET /balance/:address`; served at `faucet.<domain>` | Do not change. The faucet *page* is a new static page in `landing/` (§5.6) |
| `indexer/src` | The 25-route `/v1` API | Do not change. Read it to learn the exact routes; never invent an endpoint (the existing test checks this) |

The upgrade record, the posture record and the operator-run note ("Agents run by the Scalar Commons team to exercise the network. Identified on-chain by the `swarm-` prefix.") keep their exact wording.

## 1a. Project status today (2026-10-23) — the facts to carry

Use these to check what the chain returns and to rewrite stale prose. None of them is typed into a page as a figure: the chain, a snapshot or an operator-written record supplies every number.

- Runtime **spec 309**, applied 2026-10-05 at block 907,929 (308 was never shipped). Node release **v0.306.0**.
- The active validator set is **8**, since staking era 105 (2026-10-21); `staking.validatorCount` is 8, raised from 7 by sudo at block 1,122,976. Hosts: five validators on the operator's host; one run independently by Bourn on his own server; two operator-run on separate hosts (Ron and JC). That is four fault domains, not eight. GRANDPA tolerates ⌊(n − 1) / 3⌋ failures: two at n = 8.
- Public endpoints, all live today: `wss://rpc.scalarnet.io` (RPC), `https://api.scalarnet.io/v1` (indexer), `https://explorer.scalarnet.io`, `https://faucet.scalarnet.io` (the faucet is live, not "planned"), `https://scalarnet.io/docs`, `https://scalarnet.io/observatory`, `https://scalarnet.io/pulse`.
- Chain id `scalar-local`, genesis `0xff6882b49ad61dd3128a6e834b4f81704a3824ce358f2f69fe765ca07cf803d1`, SS58 prefix 42, CMN with 12 decimals; an era is 3,600 blocks (≈ 6 h), a session 1,800 blocks, a staking era six sessions (≈ 18 h).
- The public swarm has been quiet since block 1,009,703 (about 13 October) and the last settled era paid 0 CMN; the chain says how many agents are registered — do not type it.
- Stale in the checkout today: `landing/chain-facts.json` (spec 304, block 433,638, `state.validators: 5`), `docs/.chain/snapshot.json` (spec 306), and every sentence built on them.

## 1b. Phase 0 · the status sweep (before any visual work)

Every page must describe the project as it is today, and a count that can change is never typed into prose.

1. **Refresh the records** against `wss://rpc.scalarnet.io`: `landing/chain-facts.json` (after adding `'messages'` to `CONSTANT_PALLETS`), `landing/chain-events.json`, and `docs/.chain/snapshot.json` (`npm run snapshot:chain -- wss://rpc.scalarnet.io`). Extend `docs/scripts/snapshot-chain.mjs` to record `validators` (`session.validators.length`) and `validatorCount` (`staking.validatorCount`), and add both to the prose-facts list in `docs/scripts/check-chain-values.mjs` so the lint pins any page that states them.
2. **Counts come out of sentences.** `landing/src/content.mjs:221` reads `'{{state.validators}} validators author blocks every {{constants.babe.expectedBlockTime|secs}} seconds under BABE, with GRANDPA finality.'` It becomes `'Validators author blocks every {{constants.babe.expectedBlockTime|secs}} seconds under BABE, with GRANDPA finality.'` The count is a Reading — as-built on the home page (`Validators · n of m` from `state.validators` and `staking.validatorCount`), live on the Observatory — never a word in a sentence. Apply the same rule to every hit in step 3.
3. **Grep and fix.** Search `docs/`, `landing/`, `README.md`, `deploy/README.md` and the live-status parts of `STATUS.md` for `5 validators|five validators|5-validator|fifth authority|one host|single host|loopback-only|no public endpoint|planned|spec 30[0-9]|verified against|v0\.30[0-9]\.[0-9]` and the number words. For each hit decide: a historical statement (an upgrade applied at a block with the set of that day) stays, in the past tense, with its block or date; a current-state statement is rewritten without the number, or with the snapshot value through the lint; a wrong statement (loopback-only RPC, faucet "planned") is corrected to §1a. Known hits: `docs/guide/run-a-node.md:3–7` ("joining the 5-validator devnet", "five validators on one host, RPC on `ws://127.0.0.1:9944`" → the public testnet, `wss://rpc.scalarnet.io`, the validator count from the snapshot); `run-a-node.md:331–341` (the "fifth authority" and "five validators on one host" paragraphs → the ⌊(n − 1) / 3⌋ rule with n from the snapshot, and the hosts as an operator-written line with its `asOf` date); `docs/guide/run-a-validator.md:435` (history — keep, past tense); `docs/guide/run-an-agent.md:8` ("verified against a local spec-306 dev node" → re-verify against 309 or re-date); `docs/reference/rpc.md:9`, `token-model.md:10` and `:16` ("verified against spec 306" → 309 once the snapshot moves; the lint will demand it); `docs/reference/messages.md:16` ("not yet re-checked" → re-check against the snapshot and say so); `landing/README.md`, "Caveats the page carries on purpose" (the loopback-only RPC and the planned faucet are no longer true → delete those two caveats and describe the public endpoints); `deploy/README.md:1–12` and `:503–614` (the 5-validator, one-host narrative → the current set and hosts, operator-written with date; nothing else under `deploy/` changes); `STATUS.md` is a log — leave its history alone.
4. **Operator-written status lives in one file.** Hosts, operators and who runs what cannot be read from the chain. Record them once in `landing/public/status.json` with `asOf` dates and `source` documents, exactly as `posture.json` does, and render that file on the Observatory's Validators notes line and in `run-a-node.md` (through a snapshot-derived include or a lint-pinned literal) — never typed in two places.
5. **Tests.** The docs lint fails when the prose states a validator count that differs from the snapshot; the landing test that forbids hand-typed digits already covers `content.mjs`; add a landing test that `status.json` values carry `asOf` and `source` and that no page prints a host or operator name that is not in it.

## 2. The visual system: Nightwatch

**Concept.** The chain is a thing that happens every six seconds whether or not anyone is watching, and the site is the log kept by whoever is on watch: a field of deep pine, bone type, and one lamp. Only what is alive right now may be lit; everything else is written, not lit. Provenance is a receipt: every live figure wears a perforated stub that tears open to show the endpoint, the fetch time and the raw bytes. Time runs down the page. No rules, no borders, no boxes: structure comes from three tonal surfaces and from dotted leaders that run from every label to its figure.

### 2.1 Tokens — `landing/src/chrome/tokens.css` (the single source; everything else consumes it)

```css
:root {
  /* surfaces */
  --pine-0: #0f1f18;  /* page */
  --pine-1: #15291f;  /* sheet */
  --pine-2: #1c3328;  /* stub, field, code */
  --pine-3: #234030;  /* pressed, selected */
  /* ink */
  --bone: #efe9d8;      /* text */
  --bone-dim: #b9b3a3;  /* secondary */
  --sage: #7f8a80;      /* settled, record, disabled */
  --leader: #3b5546;    /* leaders, rails, perforations */
  /* state — each always paired with its word */
  --filament: #ffe3a3;  /* live */
  --glow: 0 0 24px rgba(255, 227, 163, 0.18);
  --vermilion: #ff5a36; /* in dispute */
  --ice: #bfe6ff;       /* slashed */
  --clay: #c98f6a;      /* operator-run */
  /* type */
  --font-sans: "Instrument Sans", system-ui, sans-serif;
  --font-mono: "Martian Mono", ui-monospace, monospace;
  --display: 600 5rem/1 var(--font-sans);        /* 80 px, tracking -0.02em */
  --h2: 600 2.5rem/1.1 var(--font-sans);          /* 40 px */
  --h3: 500 1.375rem/1.3 var(--font-sans);        /* 22 px */
  --body: 400 1.0625rem/1.6 var(--font-sans);     /* 17 px, measure 60ch */
  --small: 400 0.875rem/1.5 var(--font-sans);     /* 14 px */
  --figure-xl: 300 4.5rem/1 var(--font-mono);     /* 72 px, tabular */
  --figure-l: 300 3rem/1 var(--font-mono);        /* 48 px */
  --figure-m: 300 1.75rem/1 var(--font-mono);     /* 28 px */
  --label: 400 0.6875rem/1 var(--font-mono);      /* 11 px, uppercase, tracking +0.14em */
  --mono: 400 0.8125rem/1.5 var(--font-mono);     /* 13 px */
  /* geometry */
  --radius: 4px;
  --bar: 72px;
  --content: 1200px;
  --gutter: 24px;
  /* motion */
  --t-attack: 120ms;
  --t-cool: 1800ms;
  --t-ui: 240ms;
  --t-shift: 240ms;
  --ease-attack: cubic-bezier(0.1, 0.9, 0.2, 1);
  --ease-cool: cubic-bezier(0.2, 0.6, 0.4, 1);
  --ease-ui: cubic-bezier(0.2, 0, 0, 1);
}
```

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 160 px; nothing else. Grid: 12 columns, 24 px gutters, 1200 px content; breakpoints 1440 (12 col), 1200 (margins fold under their paragraphs), 1024 (nav collapses to the current page name + "Menu"), 390 (single column, 20 px gutters). No italics anywhere. No icons, no icon font, no gradients except the one in §3 (Curve), no drop shadows except `--glow` on the lamp and on filament elements, no cards, no borders: a `border` property is allowed only on the focus ring, a stub's perforation and a code block's inset.

**One theme.** Delete the light scheme. A print stylesheet (`print.css`: bone page, pine ink, no glow, leaders kept, every receipt line printed, the URL and "printed <UTC>" in the foot) is the only second face.

**Fonts.** Self-hosted via `@fontsource-variable/instrument-sans` and `@fontsource-variable/martian-mono` (fall back to the static `@fontsource/...` packages if the variable ones are unavailable), copied into `dist/fonts/` by the build like today, `font-display: swap`, `font-variant-numeric: tabular-nums lining-nums` on every figure. No request to Google Fonts or any third party.

**Contrast.** Every text pair must pass WCAG AA: bone and bone-dim on all three pines, sage ≥ 3:1 on pine-0 and pine-1 (it is only used at 11 px for labels that also carry a word), filament/vermilion/ice/clay as text only on pine-0 and pine-1. Add a test that computes this from `tokens.css` (the repo already has a contrast helper in `observatory.test.mjs`; reuse it).

### 2.2 The lamp rule

Filament appears only on what is live right now: the lamp, the active nav word, the Spine's newest tick, the figures that changed in this session, live stubs, the current era's fill in the Day Bar, working embers, the curve lines and the pooled light under them. A record (anything read from a file, or at build time) is sage. A stale figure cannot glow. Each state colour is always paired with its word (`LIVE`, `SETTLED`, `IN DISPUTE`, `SLASHED`, `OPERATOR-RUN`) in a tag or a stub, so colour is never the only carrier.

## 3. Components — `landing/src/chrome/`

Plain HTML templates (functions returning strings, like `render.mjs` does today), one CSS file (`chrome.css`) and small ES modules for behaviour. The same chrome is consumed by the landing pages, the observatory and pulse bundles, the docs theme and the explorer. Mechanism for sharing without a monorepo: `landing/scripts/sync-chrome.mjs` copies `tokens.css`, `chrome.css`, `print.css` and the font files into `docs/.vitepress/theme/chrome/` and `explorer/src/chrome/` (committed copies), and a landing test asserts the copies are byte-identical to the source so drift fails the build.

| Component | Spec |
|---|---|
| `Reading` — the atom | label (`--label`, bone-dim) · leader · figure (`--figure-*` or `--body` for a sentence) · stub · optional receipt line. Constructed with a `source` object `{method, url, fetchedAt, block, raw}`; a Reading without one throws at render time (the build fails). Hover: the leader turns filament; focus: 1 px filament ring at 4 px offset; loading: the leader runs to nothing and a 2 px filament segment travels along it (1,200 ms, linear, the site's only loop, only while loading; reduced motion: the word "loading" at the leader's end) |
| `Leader` | 2 px dots at 6 px pitch in `--leader`, drawn with `background-image: radial-gradient(circle, currentColor 1px, transparent 1px)` sized 6×2 px repeated on x, 12 px clear each side, aligned to the figure's baseline; flex-grows; on mobile the label stacks over the figure and the leader shortens to 24 px. Between stacked message blocks it carries a two-dot arrowhead |
| `Stub` + `Receipt` | A 20×28 px tab at the figure's right edge, perforated left edge (1 px dashed `--leader`, 2/2), filled by state: filament live, sage record, vermilion dispute, ice slashed, clay operator-run; a sealed record (never read from the chain, e.g. `posture.json`) draws its perforation solid and does not tear. Click, or the Sources switch, tears it: a 280 px pine-2 panel unfolds beneath (`--t-ui`, `--ease-ui`) with three `--mono` 11 px lines — the request (`GET api.scalarnet.io/v1/status`), `fetched <UTC> · block <n>`, `raw ↗` to the exact bytes — and a fourth naming the computation when the figure is derived. Sources on also prints the inline receipt line (11 px, bone-dim) under every figure. This replaces the current provenance tooltip/line pair; keep `sources.js`'s localStorage memory |
| `Tag` | `--label` text on pine-2, 4 px radius, 6/10 px padding, with a state dot: `LIVE`, `SEALED · BLOCK n`, `IN DISPUTE`, `SLASHED · ERA n`, `OPERATOR-RUN`, `AS BUILT · <UTC>` (no dot, dim) |
| `Lamp` | 8 px filament dot with `--glow` and `--label` text: `block 1,234,567 · finality 2 · normal`. States: normal; connecting (sage, unlit, `connecting · wss://rpc.scalarnet.io`); lagging (lit, no glow, finality figure in vermilion); stalled (vermilion dot, `last block <UTC> · n min ago · stalled`); index behind (lit, `index −n` in vermilion). Lit only while the socket is open and the last block is under 30 s old. Fed by `context.js`'s head/finalized subscriptions; this replaces the status pill |
| `SourcesSwitch` | 20×10 px pill on pine-2 with an 8 px bone knob; on: pill filament at 30 %. Tears every stub in document order, 20 ms stagger, 400 ms cap |
| `Button`, `Quiet`, `Field`, `Filter`, `Segments`, `Pager`, `Copy` | Button: bone surface, pine ink, `--label` uppercase, 56 px, 0 24 px; hover filament, pressed bone-dim, disabled sage, loading three 4 px dots. Quiet: `--mono` with a dotted underline, hover solid filament. Field: pine-2, 56 px, `--mono` 15 px, focus ring + filament caret, invalid vermilion text with a 14 px line beneath. Filter/Segments: `--label` words separated by ` · `, the selected in filament. Pager: `1–20 of 40 · next →`. Copy: `--label` "Copy" revealed on hover, "Copied" in filament for 1.2 s |
| `Ledger` | Rows 48 px (`row`), 64 px (`sheet`), 48 px collapsed (`mobile`): index in `--label` dim, hash `--mono`, call in 15 px, signer with a dotted underline, a leader to the block, a state dot. Hover pine-1, selected pine-3, loading three sage bars at 60 % |
| `Rail` | Vertical time rail: 1 px dotted `--leader` at 24 px inset, 4 px ticks, entries 56 px apart (48 mobile), newest on top; the newest tick a 6 px filament dot with glow; finalized ticks sage; a vermilion tick at a dispute, an ice tick at a slash |
| `DayBar` | 1200×12 px (350×8 mobile), four 300 px segments = the last three settled eras (sage) and the current one filling left to right with filament by elapsed blocks; a 2×16 px bone tick at each segment's end; `--label` beneath: `era n · <emission> CMN` for settled, `era n · k of 3,600 · h m` for current. `role="progressbar"`, `aria-valuenow` in blocks. Sticky at 12 px over the Economy section |
| `Ember`, `EmberBank` | One 24×3 px bar per agent whose opacity is exactly the agent's heartbeat multiplier (`pallets/agents/src/lib.rs:1987–2004`: 100 % within the 18 h grace, then linear to a 10 % floor over 90 days), filament on pine-2; vermilion at full when in dispute; ice when slashed; a 1 px clay tick at the left end when operator-run; outlined when unstaking. The bank: rows of 24 at 4 px gaps, ordered by agent id, 24 px row pitch; hover → tag with name, last heartbeat, multiplier; click → explorer. Replaces today's cell grid. Canvas, redrawn on event only. `role="img"` + alt sentence; "the same agents as a list" link kept |
| `Spine` | A vertical column of one horizontal tick per block, newest on top, on a 1 px dotted rail. `margin` form (Observatory left margin, 96 px wide): 16×2 px ticks at 8 px pitch, 100 blocks, the newest a 6 px filament dot with glow, unfinalized bone, finalized sage, a block number every tenth tick. `explorer` form: 56 px rows (number, time, extrinsic count, author, event glyphs). `comb` form (presenter): horizontal, 240 ticks across 1,600 px. Fed by the head bus; author resolved through the BABE pre-digest (the code is in `observatory/`) |
| `Waterfall` | Pulse's instrument (§5.3) |
| `Curve` | D3 `d3-shape` SVG: 1.5 px filament line (`curveMonotoneX`, `curveStepAfter` for the diversity staircase) and the pooled light beneath — a vertical fade from filament at 12 % at the line to 0 at the baseline. **This fade is the site's one permitted gradient.** No gridlines, no axis lines; three `--label` values at the left edge; a lit 6 px end dot; event ticks on the baseline in state colour; hover: dotted vertical + tag. Sizes 400×120, 1200×200, 358×100. `role="img"` + alt + a table fallback |
| `Redaction` | Solid bone bar, square ends, 4 px taller than the line, `no key held` inside in pine when sealed; lifted = raised 8 px at 30 % opacity over the plaintext; hash-only = a 32×2 grid of 4 px squares in bone and sage. Lifts once on scroll-in (`--t-ui`) |
| `Code`, `Raw`, `Inline`, `Address`, `AgentName` | Code on pine-1, 24 px padding, `--mono`, filament keywords, no line numbers, Copy top-right. Raw JSON on pine-2 at 12 px. Address `--mono` truncated six…four with a dotted underline; hover a pine-2 tag with the full SS58 and Copy. AgentName `--mono` dotted underline, clay if operator-run, a vermilion dot after it if in dispute |
| `Palette` (⌘K) | 640×420 px pine-1 sheet; input; sections AGENTS · ACCOUNTS · BLOCKS · DOCS · COMMANDS; results as 15 px title + `--label` receipt line; `↑↓ move · ↵ open · ⇥ section · esc close`. Plain JS; no cmdk dependency. Searches the index for agents/accounts/blocks and a built-in list of docs pages |
| `Sheet`, `Band`, `MarginNote` | Mobile bottom sheet (28 px handle, pine-1). Band: full-width pine-1 strip, 16/24 px padding, 14 px text + receipt line — index-behind, scripts-off, testnet-reset forms. MarginNote: `--label` label over 14 px dim text with a leader running left to its paragraph; folds inline under 1200 px |
| `TopBar`, `Footer` | Bar 72 px (64 mobile), pine-0, pine-1 when scrolled: wordmark (Instrument Sans 500 17 px) · nav in `--label` (OBSERVATORY · PULSE · EXPLORER · DOCS · OVERSIGHT · FAUCET; the current page in filament with a glowing 1 px underline) · the lamp · "Sources" + switch · "⌘K" tag · "Present" (Observatory only). Under 1024 px: current page + "Menu"; at 390 px a 36 px scrolling nav row beneath the bar. Footer 160 px on pine-1: CHAIN (Observatory · Pulse · Explorer · Status) · BUILD (Docs · SDK · Faucet · GitHub) · GOVERN (Constitution · Evidence · Changelog · Disclosures) as `--mono` links under `--label` heads; at the right `genesis <hash short>`, `spec <n> · node <version>`, `site built <UTC> against block <n>`; bottom line 14 px dim: `Testnet — the token has no value and the chain may be reset.` No tagline, no copyright line |

## 4. Motion

**One rule.** Nothing moves on its own except the chain. One event bus (`context.js`'s head/finalized subscriptions; fallback `GET /v1/status` every 6 s) drives every ambient movement: the lamp ticks, the Spine grows a tick, the Waterfall grows a row, the Day Bar's fill advances, and the digits of a live figure that changed warm and cool. Everything else moves only on a person's action. No idle animation, no shimmer, no parallax, no page transitions, no cursor effects, no smooth-scroll library.

**Incandescence.** A response to an event is a fast attack (`--t-attack`, `--ease-attack`: from the resting colour to filament with the glow) and a long cool (`--t-cool`, `--ease-cool`: back to bone, dim or sage). Only colour, opacity, `transform: translateY` and `box-shadow` animate; never width, height, layout or blur.

| Element | Trigger | Motion | Reduced motion |
|---|---|---|---|
| Lamp | new block | glow 24→32 px and back; the number swaps instantly | number swaps only |
| Spine tick | new block | born at 0 opacity, warms; the previous newest cools; the column shifts one pitch (`--t-shift`) | appears in place |
| Finalized boundary | finalized head | ticks at/below turn sage | instant |
| Waterfall row | new block | new row at 60 % warming to full; rows shift 6 px (3 mobile) | appears in place |
| Live figure | value changed | only the digits that changed warm and cool; no odometer, no tween | instant |
| Day Bar | new block / `EraSettled` | fill advances linearly; on settlement the segment cools to sage, a new one is born, the bar slides left | instant |
| Ember | `Heartbeat` for that agent | warms to 100 % and stays | instant |
| Reading hover | pointer | leader → filament; surface → pine-1 | instant |
| Stub tear / Sources | click | stub +4 px right; receipt unfolds (`--t-ui`) | instant |
| Redaction lift | scroll-in, once | +8 px, to 30 % | already lifted |
| Palette, Sheet | open | opacity 0→1, 2 px rise (`--t-ui`); page behind to 60 % | instant |
| Presenter | → / ← | sections cross-fade 400 ms; the lamp and Spine keep ticking | cut |

Hidden tab: socket open, rendering paused; on return rebuild from the index, do not replay. Stalled or disconnected: nothing fades; the lamp goes unlit, every live stub goes sage with `as of <UTC>`, figures keep their last value. `prefers-reduced-motion` is honoured in every row above and the existing "no instrument loops forever" test is kept and extended to the new components.

## 5. Pages and their copy

Everything below is the complete content. Where a figure appears it is a `Reading` with a source; where a sentence appears it goes into `content.mjs` with placeholders for any number. Do not add captions, sub-lines, status bars, badges, taglines, buttons or links that are not listed. Do not shorten the disclaimer.

### 5.1 Home (`/`)

Reader: a builder or an evaluator arriving cold. Script-free, as today.

1. **Hero.** Eyebrow `LAYER 1 · RUNTIME SPEC {{spec}} · TESTNET`. Headline `Coordination infrastructure for autonomous AI agents` (`--display`, three lines). One sentence: `Agents register, contract, deliver, and get paid — with the coordination primitives in the runtime.` Right column, three Readings at `--figure-m`, record stubs (sage) because the home page is built, not live: `Height` (snapshot block), `Era` (`n · k of 3,600 blocks`), `Validators` (`n of m`), each with its receipt line `chain-facts.json · block n · <UTC>`.
2. **The river** — keep the existing 140 px block strip as a static SVG of the snapshot (one 3 px bar per block, FINAL marker), caption `block n · as built <UTC>`.
3. **Manifesto band.** `Stake alone earns nothing.` (`--display`) and `Emissions reward verifiable work, not a balance. An agent that only stakes has a weight of zero.` The √ curve etched behind at 4 %.
4. **01 · What the chain does.** Seven rows, each: pallet name (`--h3`), one sentence, and `n calls ›` (a disclosure that expands to the extrinsic names from `chain-facts.json`; the counts come from the metadata, never typed). Sentences: agents — `Register with a stake, say what you can do, prove you are alive.` escrow — `Lock the fee, deliver, confirm or dispute.` oracle — `Ask a question, pay for answers.` orchestrator — `Let one agent hire others, for up to {{constants.orchestrator.maxOrchestratorFeeBps|percent}}.` emissions — `Every era, pay agents for settled work.` messages — `Sealed or plain messages, {{constants.messages.<maxPerBlock as the fetcher names it>}} per block.` auto-params · constitution — `Fees and bounds tune themselves inside limits.` Placeholder paths are whatever `fetch-chain-facts.mjs` emits (camel-cased constant names under `constants.<pallet>`); add filters to `render.mjs` (`blocks→days`, `blocks→hours`, `bps→percent` exists) rather than ever writing a number.
5. **02 · The token model.** One hairline row of five Readings: Supply cap (`constants.emissions.supplyCap|cmn`) · Era (`constants.emissions.eraDuration` blocks, with an `≈ h` filter from `constants.babe.expectedBlockTime`) · Minimum stake (`constants.agents.minStake|cmn`) · Registration fee (`constants.agents.baseRegistrationFee|cmn`) · Unstake cooldown (`constants.agents.unstakeCooldown` through a `days` filter).
6. **03 · Emissions reward verifiable work.** Four `Curve` small multiples computed at build time from the constants: √stake (`exponent ½`); log₂ volume (`log₂ of settled volume, in units`); buyer diversity staircase (`0, 10, 30, 60, 80, 100 %`); heartbeat decay (`full for 18 h, then to a 10 % floor over 90 days` — the curve ends at 10 %, never at the axis). Beneath, the formula in a `Code` block: `weight = √stake × rank × activity × heartbeat × (1 + oracle) × (1 + onboarding) × (1 + velocity)` with the line `activity = floor + governance + β · work, and is zero without settled work this era`. Then the caveat exactly as `content.mjs` carries it today: the oracle term is inert (`type OracleScoreProvider = ();`).
7. **04 · The network today.** Four Readings from the snapshot: Height · Validators · Registered agents (sub-line `n operator-run`) · Open disputes; then the FAILED GATE block and the two caveat notes exactly as they exist in `content.mjs` today (the hatched rule becomes a 2 px dotted vermilion left rule).
8. **05 · Where to go next.** Four Readings with leaders to their URLs: Docs `scalarnet.io/docs` · Explorer `explorer.scalarnet.io` · Faucet `faucet.scalarnet.io` · Source `github.com/tejaspatil1936/scalar-commons-v4`. Anything unbuilt is labelled `planned`, as the test requires.
9. **06 · How to check any of this.** The ledger of §7 rendered as rows: claim · leader · `file:line` and the Rust line in a `Code` strip with Copy. Show six rows and `10 more ›`.
10. **Footer** (§3).

### 5.2 Observatory (`/observatory`)

Reader: a watcher or an evaluator reading the chain's live state. Same data as today, re-drawn.

- The bar with the lamp, Sources, ⌘K and Present. The `margin` Spine down the left of the first screen.
- First screen: `Observatory` (`--display`), `The public chain, read from a running node. Every figure names its source.` Four Readings at `--figure-xl` with live stubs: Height · Agents registered (sub-line `n operator-run`, then the operator-run note verbatim) · Active in the last settled era · Agreements open. Then `ACTIVITY IN THE LAST HOUR`: four `--figure-m` Readings (Oracle answers · Agreements settled · Disputes opened in vermilion · Slashes in ice), counted as today, with the index-behind sentence when needed. Right: the `EmberBank` with its legend, live line and footnote; the Network-graph switch keeps its lazy bundle (restyle it: filament/sage/vermilion only, no force-graph colours).
- The river as today, re-drawn in the tokens (newest filament, final sage), titled `Blocks arriving now`.
- 01 Chain: four Readings in a hairline row. 02 Economy: the `DayBar` (replacing the era dial) and three Readings (Time to settlement · Issued to agents to date · Open disputes). 03 Validators: the ring re-drawn as eight points on a 240 px circle (the authoring validator filament, the rest bone), two Readings (Active set · Node health) and the notes line exactly as the current page states it. 04 History: four `Curve` small multiples. 05 Upgrades: the rail as a `Rail` with every row of `runtime-history.json`, hashes in full with Copy, the live `system.CodeUpdated` confirmation slot, and the dim note `308 was never shipped`. 06 Verify: the three commands and the posture record's rows under `SECURITY POSTURE · RECORD, NOT LIVE`, each value with its `source` document and `asOf` date, `null` → `not yet recorded`. No badge.
- Presenter mode keeps its behaviour; the slides use the `comb` Spine and figures at 160 px.

### 5.3 Pulse (`/pulse`)

Reader: anyone, one screen. 1440×900, nothing below the bottom strip; F for fullscreen; no footer.

- Three Readings with the existing three sources: `Agents active in the last ten minutes` · `Events in the last minute` · `Messages in the last hour`.
- **The Waterfall** replaces the constellation: every registered agent is a column (4 px wide, 1 px gaps on desktop; 1 px, no gap on mobile; ordered by agent id), time flows down one row per block (6 px desktop, 3 px mobile, ~100 rows visible), column heads as 1 px ticks (clay for operator-run, filament with glow for an agent that joined in the window). Glyphs, from `model.js`'s event table: agreement opened = a 1 px filament line between the two columns with 3 px end ticks; message sent = a 4×4 cell in the sender's column and a 1 px dim line to the recipient; work paid for = a 4×6 bright bone cell at the provider with the line between the two in sage; dispute opened = a 1 px vermilion line repeated on every row until it settles; oracle answer = a 1×12 vertical filament tick; agent joined = the head lit. A `--label` time rail at the left every tenth row. Canvas 2D, one draw per block, paused when hidden. States: live; connecting (40 % opacity from the index); index behind (a `Band` across the top, every glyph sage); quiet (empty rows keep arriving and the feed says `no agent events in the last hour · last at block n`).
- The feed at the right: `LIVE` with the lamp dot, eight sentences from `model.js`, each exactly the sentence + block link + `n s ago`; it is a real `<ol aria-live="polite">` throttled to one announcement per 30 s and is the accessible version of the Waterfall.
- Legend row with the six glyphs drawn small and named; `n/m operator-run`.
- Bottom strip: `Height · Finalized · Era` left, the disclaimer and `F fullscreen` right.

### 5.4 Docs (`/docs/…`)

A VitePress custom theme (`docs/.vitepress/theme/index.ts` + `Layout.vue`) consuming the synced chrome. Every existing page and route stays; `npm run lint` stays.

- **Docs home**: eyebrow `DOCUMENTATION · RUNTIME SPEC {{spec}}` (from `.chain/snapshot.json`), title `Read, then run.`, one paragraph: `Everything an operator, an agent author or a validator needs, checked against the node it describes.` A search field (VitePress local search, restyled). Three Readings: Pages (counted at build) · Last checked against the node (from the snapshot's timestamp) · Snapshot drift (`0 pages` when `check-chain-values` passes; the number of drifted pages otherwise). Then `THE WATCH-LOG`: the sidebar groups as a ledger — number (`--figure-l` dim), group name (`--h3`), page count behind a leader, page titles in `--mono` with dotted underlines.
- **Article**: three columns inside 1200 px — 240 px index (current page in filament with a 2 px tick; `ON THIS PAGE` anchors), 640 px reading column (breadcrumb, `--h2` title, standfirst from the page's description, a receipt line `checked against spec n · <UTC> · 0 drift` on pine-1), 240 px margin for `MarginNote`s (rendered from a `::: note LABEL` container; under 1200 px they fold inline). Code blocks per §3. A receipts footer on pine-1 listing the page's `file:line` citations (rendered from frontmatter `receipts:` entries) and the sentence `npm run lint fails this page if any figure above drifts from the node snapshot.` Prev/next as `← Keys` / `Elect →`.
- Mobile: single column, sticky `ON THIS PAGE ▾` sheet, code blocks scroll horizontally.

### 5.5 Explorer (`explorer.scalarnet.io`)

Replace the HTML shell and `STYLES` in `explorer/src/render.ts` with the synced chrome (the bar, the lamp, the footer). The explorer is server-rendered and stays so: the lamp and every Reading are filled from the node at request time and carry an `AS OF <UTC>` tag; no client-side socket is added. Keep every route and view; re-set them:

- **Home**: search field (`block number, hash, extrinsic, address, agent name`), six Readings in a row (Best · Finalized · Era `n · k / 3,600` from the emissions pallet's storage · Session `n · k / 1,800` · Validators · Issuance) with their RPC or storage names as receipts; the `explorer` Spine for the last 16 blocks in columns 1–4; `EXTRINSICS` and `EVENTS` ledgers (last twelve) in the remaining columns; `Pending in the pool` from `author_pendingExtrinsics`; footer line `indexer api.scalarnet.io · syncedHeight n · k behind`.
- **Block**: number at `--figure-xl` with `FINALIZED` (sage) or `BEST · not final` (filament) tag, prev/next, the receipt readings in two columns (hash, parent, state root, extrinsics root, time, author, slot, era · session, spec, weight, counts), `EXTRINSICS · n` sheet rows, `EVENTS · n` grouped under their extrinsic index with `▸ raw` JSON.
- **Extrinsic**: call name as title, full hash with Copy, an outcome tag (`SUCCEEDED` / `FAILED · pallet.Error` in vermilion / `PENDING · in the pool`), one plain sentence built from the call's decoded args by the existing formatter (no templates that invent facts), the receipt readings, the decoded `CALL` block with `▸ raw`, the events. For `escrow.dispute` add `WHAT HAPPENS NEXT` with three Readings from the runtime constants (bounty bps, burn bps, who settles) citing `runtime/src/lib.rs:1297–1299`.
- **Account**: name from the on-chain agent name if any, else the address; the full SS58 with Copy; role tags (`VALIDATOR STASH`, `BONDED`, `AGENT`, `OPERATOR-RUN`); balances as four Readings; `STAKING` or `AGENT` readings; `HISTORY` as a `Rail` with a filter line; an unknown address shows zeros and `No activity in the index for this address.`
- **Activity** (`/activity`, agent-scoped): the five Readings (earned all time · earned this era · agreements open · in dispute · counterparties), `EARNINGS BY ERA` as a `Curve` from `/v1/agents/:address/escrows` and `/v1/eras`, `COUNTERPARTIES` ledger with share bars, `WATCH-LOG` rail; decayed and cooldown states as tags.
- 404 and index-behind as `Band`s.

### 5.6 Faucet page (`/faucet`, new, static, in `landing/`)

One receipt-shaped form: eyebrow `TESTNET FAUCET · OPERATOR-RUN` (clay dot), title `Two thousand test CMN, once an hour.` (the amount and interval read from `GET https://faucet.scalarnet.io/health` at runtime, never typed), one line `Paste an address. The faucet signs a transfer from its own account and shows you the extrinsic. Nothing here has value.`; `ADDRESS` field; Readings `Amount` and `Next drip for this address`; one Button `SEND`; the `--label` line `POST faucet.scalarnet.io/drip · rate limit 1 per address per hour · 1 per IP per hour` (limits from `/health` if it exposes them, otherwise omit the clause); the faucet account's Readings (address, balance via `/balance/:address`, last drip from the index); `RECENT DRIPS` ledger from the index. States: sent (a receipt stub with the extrinsic hash and an explorer link), refused (`That is not an SS58 address for this chain (prefix 42).`), rate-limited. Check the CORS headers in `deploy/public/nginx/scalar-commons.conf.template` first; if the browser cannot call `faucet.<domain>` from `scalarnet.io`, the page shows the `curl` command instead of the form and says why.

### 5.7 Oversight (`/oversight`)

**The page already exists on the unmerged branch `claude/oversight-sample`** (2026-10-07): `landing/public/oversight-sample.json` (a real 40-row record with provenance and summary), `landing/src/oversight.mjs`, `src/oversight.css`, `src/oversight/{main,rpc,verify}.js`, `scripts/build-oversight-standalone.mjs`, and tests under `landing/test/oversight*`. Its honesty logic is exactly what this brief wants — every on-chain field is rendered from the record and re-read live in the browser, a disagreeing row is marked, the signature check is labelled as the tool's and the blake2b-256 re-computation as the reader's own. Do this: `git merge origin/claude/oversight-sample` into the site branch (resolve conflicts in favour of the status-sweep records), keep its data, logic and tests unchanged, and restyle only: title `What an operator can and cannot read`; standfirst `Forty real messages from a development chain, decrypted by the operator with the keys it holds. This page signs nothing and submits nothing.`; the five summary figures as Readings with the labels `Operator keys matching the chain` · `Decrypted by the operator` · `Sealed, no key held` · `Signatures verified` (sage stub, the tool's check) · `Re-checked in your browser` (filament stub, the reader's check); `HOW TO READ THIS` as five rows, exactly: `Public to everyone` — sender, recipient, kind, agreement tag, block, nonce, payload length, payload hash; `Encrypted` — the body, a NaCl box to the recipient's published key; `Decrypted, by whom` — the bodies the operator decrypted with its own escrowed keys, for its own agents only; `Re-checked by your browser` — the plaintext's blake2b-256 against the chain's commitment; `Not checked here` — signatures, verified by the operator's tool; then one negotiation (three message blocks joined by leaders with arrowheads) and the ledger (`Ledger`, six rows shown, `6 of 40 · all 40 →`), sealed bodies as `Redaction`s, decrypted bodies lifted, a disagreeing row in vermilion with its word. Never add a row, a field or a figure the record does not carry.

### 5.8 Shared states

`404.html`: `404` at `--figure-xl` dim, `Nothing is logged at this address.`, three Readings (`You asked for` — the path, filled client-side from `location.pathname` · `Closest page` — the nearest entry of the built route list by edit distance, omitted when nothing is close · `Or · search the docs · ⌘K`). Scripts off: every live page renders its build-time snapshot with a `Band`: `Scripts are off. Every figure on this page is from the build, <UTC>, and carries its source. Nothing will move.` (the landing is script-free already; the observatory and pulse must degrade to this). Print: `print.css`.

## 6. Data rules (the part that is enforced)

1. Every `Reading` has a `source`; the build throws without one.
2. Prose carries no literal digits (`claims.test.mjs` stays). The sample figures used in design prompts (block 1,115,263 · issuance 6,054,836,317 · era 141 · agents 214 · agreement 5GbFZC…8pcj · any `swarm-NNNN` as a specimen) must never appear in a built page; add this list to the forbidden-strings test.
3. Zero is a value. The quiet-swarm state, `era n · 0 CMN`, an empty Waterfall and an index behind the chain are designed states with receipts, never errors and never hidden.
4. Names: agent names come from the chain (`swarm-` prefix marks operator-run, as today); validators are addresses unless a committed register file names them (none exists today — do not create one).
5. The disclaimer `Testnet — the token has no value and the chain may be reset` is in every footer, mobile footer and print, 14 px, never smaller than `--label`.
6. Nothing is read from the GitHub API or any third party except what the observatory already reads (the existing "contacts only the chain API, the chain RPC and GitHub" test stays).

## 7. The ledger (claims → file · line on `master 7aa65fa`)

Add every row to `source-claims.mjs` so the existing snippet test enforces it; the home page shows six, the docs cite them. Verify each line number against the checkout before committing — if the tree has moved, correct the line, never the claim.

| # | Claim | File · line | Rust |
|---|---|---|---|
| 1 | The supply cap is 100 B CMN; 18 B were minted at genesis | `runtime/src/lib.rs:83`, `:84` | `pub const SUPPLY_CAP: Balance = 100_000_000_000 * CMN;` · `pub const GENESIS_MINT: Balance = 18_000_000_000 * CMN;` |
| 2 | An era is 3,600 blocks, about six hours | `runtime/src/lib.rs:102`, `:1347` | `pub const ERA_BLOCKS: BlockNumber = HOURS * 6;` · `pub const EmissionsEraDuration: BlockNumber = ERA_BLOCKS;` |
| 3 | Validators are not paid | `runtime/src/lib.rs:952` | `type EraPayout = ();` |
| 4 | An agent stakes at least 1,000 CMN | `runtime/src/lib.rs:1232` | `pub const AgentsMinStake: Balance = 1_000 * CMN;` |
| 5 | Unstaking takes 7 days | `runtime/src/lib.rs:1235` | `pub const AgentsUnstakeCooldown: BlockNumber = 7 * DAYS;` |
| 6 | Registering costs 50 CMN | `runtime/src/lib.rs:1236` | `pub const AgentsBaseRegistrationFee: Balance = 50 * CMN;` |
| 7 | A heartbeat is good for 18 h; then weight decays over 90 days to a 10 % floor | `runtime/src/lib.rs:1243`, `:1244`; `pallets/agents/src/lib.rs:1987`, `:2003`, `:2004` | `AgentsHeartbeatGrace … HOURS * 18` · `AgentsHeartbeatDecay … DAYS * 90` · `pub fn heartbeat_multiplier(…)` · `let pct = 100u128.saturating_sub(90u128 * over / decay_u128);` · `pct.max(10)` |
| 8 | An orchestrator takes at most 5 % and cannot link to itself | `runtime/src/lib.rs:1250`; `pallets/orchestrator/src/lib.rs:392` | `pub const OrchestratorMaxFeeBps: u32 = 500;` · `ensure!(orchestrator != sub_agent, Error::<T>::SelfLink);` |
| 9 | An agreement escrows at least 10 CMN | `runtime/src/lib.rs:1292` | `pub const EscrowMinAmount: Balance = 10 * CMN;` |
| 10 | A correct dispute earns 2 % of the escrow, at least 1 CMN; nothing is burned | `runtime/src/lib.rs:1297`, `:1298`, `:1299` | `EscrowDisputeBountyBps: u32 = 200;` · `EscrowMinDisputeBounty: Balance = CMN;` · `EscrowDisputeBurnBps: u32 = 0;` |
| 11 | The oracle bonus is 20 % on paper and inert in practice | `runtime/src/lib.rs:1348`, `:1382` | `EmissionsOracleBonusBps: u32 = 2_000;` · `type OracleScoreProvider = ();` |
| 12 | Under 50 CMN of settled volume in an era earns nothing; the velocity bonus is 30 % | `runtime/src/lib.rs:1356`, `:1362` | `EmissionsMinQualifyingVol: Balance = 50 * CMN;` · `EmissionsVelocityBonusBps: u32 = 3_000;` |
| 13 | A message costs 0.02 CMN plus 0.0001 CMN per byte; four per block | `runtime/src/lib.rs:1403`, `:1407`, `:1410` | `MessagesBaseFee: Balance = CMN / 50;` · `MessagesPerByteFee: Balance = CMN / 10_000;` · `MessagesMaxPerBlock: u32 = 4;` |
| 14 | Anyone may settle an era, once, when it is due | `pallets/emissions/src/lib.rs:246`, `:250`, `:260`, `:266` | `pub fn settle_era(origin: OriginFor<T>) -> DispatchResult {` · `ensure_signed(origin)?;` · `Error::<T>::EraNotDue` · `Error::<T>::EraAlreadySettled` |
| 15 | Weight is √stake × rank × log₂ volume × buyer diversity; governance counts only with work; the first ten completions carry a boost | `pallets/emissions/src/lib.rs:673`, `:676–679`, `:688`, `:691`, `:723`, `:802–810`, `:336` | `let sqrt_stake = integer_sqrt(stake_u128);` · `let rank_bps … 0 \| 1 => 10_000, 2 => 12_000, _ => 15_000` · `let raw_vol = log2_scaled(vol_u128, unit_u128);` · `let work_score = if raw_vol == 0 \|\| diversity_bps == 0 { 0` · `let gov_contribution = if work_score > 0 {` · `fn diversity_score_bps … 0, 1_000, 3_000, 6_000, 8_000, 10_000` · `let onboarding_boost: u128 = if completions < 10 {` |
| 16 | An era can never mint past the cap; genesis is accounted to the token | `pallets/emissions/src/lib.rs:635`; `node/src/chain_spec.rs:41` | `let mintable = supply_cap.saturating_sub(total_issued).min(pending_u128);` · `FOUNDERS_ALLOC + RESEARCHERS_ALLOC + TREASURY_ALLOC + BOOTSTRAP_ALLOC == 18_000_000_000 * CMN,` |

The Rust column above is abbreviated for width (`…`, joined fragments). In `source-claims.mjs` every `snippet` must be a verbatim, contiguous excerpt of the cited line as it stands in the checkout, because `claims.test.mjs` greps the repo for it; open each file and copy the line.

Three things the pages say that are not in the runtime and where their receipts point: the validator count is chain state (`staking.validatorCount`, raised to 8 by sudo at block #1,122,976); the node version and chain spec come from the release and `https://scalarnet.io/docs/chainspec.json`; the posture record is operator-written (`public/posture.json`). None may be hard-coded.

## 8. Build, verify, report

```sh
# landing
cd landing && npm ci --no-audit --no-fund && npm run build && npm test
# docs
cd ../docs && npm ci && DOCS_BASE=/docs/ npm run build && npm run lint
# explorer
cd ../explorer && npm ci && npm run typecheck && npm test && npm run build
# the chrome copies
cd ../landing && node scripts/sync-chrome.mjs --check
```

Also verify: `dist/index.html` contains no `<script>` (the landing stays script-free); every built page contains no string from the forbidden list; `grep -c "fonts.googleapis\|cdn\." dist/*.html` is 0; `dist/observatory.js` imports nothing from `force-graph` or `gsap`; the docs build emits `/docs/assets/` URLs. If Chromium is available (`npx playwright` or a system `chromium`), render every page at 1440 px full-page and at 390 px into `/tmp/site-review/` and look at them before calling a phase done; do not add Playwright to any `package.json`.

Report after each phase: the commands run with their real output, the files changed, screenshots if any, and anything in this brief you could not do and why. If a figure, route or constant this brief names does not exist in the repo or on the chain, say so and leave the slot as a leader to nothing — do not invent it.

## 9. Phases (one commit each)

0. `site: status sweep` — §1b in full: the three records refreshed against the public RPC, every stale sentence rewritten, `status.json` born, the docs lint and the landing tests green on the old design before any visual work. This phase is also the one to merge first if the rest takes longer than a day: it fixes the live site's wrong statements on its own.
1. `site: chrome` — `landing/src/chrome/` (tokens, chrome.css, print.css, templates, behaviour modules, sync script), fonts, the contrast test, the forbidden-strings extension. Nothing visible changes yet.
2. `site: home` — `render.mjs`, `content.mjs`, `source-claims.mjs` (§5.1, §7), `404.html`, footer; honesty tests green.
3. `site: observatory` — frame and instruments re-drawn (§5.2), lamp replaces the pill, stubs replace tooltips, Day Bar replaces the dial, EmberBank replaces the cell grid, Spine added; design-contract tests rewritten; presenter kept.
4. `site: pulse` — the Waterfall (§5.3); `force-graph` and `gsap` removed; pulse tests rewritten.
5. `site: docs theme` — the VitePress theme (§5.4); lint green; `DOCS_BASE` build verified.
6. `site: explorer` — the shell and views (§5.5); typecheck and tests green.
7. `site: faucet and oversight` — the faucet page (§5.6) and the merged, restyled oversight page (§5.7).
8. `site: pull request` — open the PR with: a one-paragraph summary; the screenshots; and **deploy notes** for the operator: landing and docs are picked up by the host timer after merge; the explorer needs `cd explorer && npm ci && npm run build && systemctl --user restart scalar-explorer.service` on the host; nothing else changes on the host.

Done means: all four builds pass with the commands in §8; every test in the repo passes; no file under `.github/` changed and nothing under `deploy/` but the README's prose; no page states a count, a spec version or an endpoint that the refreshed records do not pin; no string on any page that this brief, `content.mjs` or the chain did not supply; one theme, two fonts, the lamp rule holding on every page.

## 10. Out of scope

Runtime, pallets, indexer, faucet service, node, deploy scripts, CI workflows, a light theme, internationalisation, analytics, cookies, a CMS, a blog, any marketing copy beyond §5.
