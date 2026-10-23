# Scalar Commons — the plain redesign (site, network page, explorer, docs, faucet)

You are a senior front-end engineer and the design lead on this. Rebuild the public web surfaces of Scalar Commons so they look and behave like a product page from a large, serious technology company: light, quiet, consistent, fast, obvious. The current site is a dark, decorative "ledger" with a serif display face, typewriter labels, live gauges and gadgets. All of that goes. What replaces it is deliberately ordinary — the kind of page nobody notices the design of, because everything is where they expect it.

Read this whole file before touching anything. Do not ask questions; every decision you need is here, and where something is not specified, choose the most conventional option. Earlier design briefs in this repo (`SCALAR-SITE-REVAMP.md`, `SITE-ROUND2.md`, `SITE-ROUND3.md`, anything "Nightwatch" or "Ledger") are superseded by this file and must not influence a single choice. Delete those three files in your first commit.

Time box: one session, one PR, about three hours. Work in the order in §10 so that if you run out of time what is pushed is still a coherent site.

---

## 1. The standard

Judge every screen against four questions, in this order:

1. **Can a first-time visitor say what this page is for within five seconds?** If not, the hero is wrong.
2. **Is there anything on screen a visitor cannot explain?** A label, a symbol, a toggle, a number without a unit — delete it or explain it inline. Nothing decorative survives this question.
3. **Would this screen pass review at a company whose product pages are read by millions?** Conventional header, one clear action, generous whitespace, system-level restraint. Their pages are not clever. Ours will not be either.
4. **Does it look generated?** The tells, all banned: gradient or glowing text, glassy translucent cards, floating blobs or orbs, a dark hero with neon accents, three identical icon cards in a row, emoji, sparkles, animated counters, scroll-reveal fades, typewriter effects, marquee tickers, pulsing dots, "ALL-CAPS TRACKED LABELS", decorative monospace, big serif manifesto lines, buzzwords (seamless, cutting-edge, revolutionary, unlock, empower, supercharge, next-gen, blazing), fake testimonials, "Trusted by" rows, placeholder stats, large radii on everything, drop shadows on everything, a nav with eight items, a hero that is only a slogan.

A page is done when you can remove nothing else without losing information a visitor needs.

---

## 2. Design system — exact values

One theme: light. No dark mode, no theme toggle, no `color-scheme: dark` anywhere. Print uses the same styles.

### 2.1 Colour (`landing/src/chrome/tokens.css` — these are the only colours on any surface)

```css
:root {
  --bg:        #ffffff;   /* page */
  --bg-2:      #f6f7f9;   /* subtle surface: table header, code, hero band if any */
  --border:    #e3e6ea;   /* hairlines, card and table borders */
  --control:   #8a919a;   /* input and control outlines (3.2:1 on white) */
  --text:      #1a1c1e;   /* primary text, 17:1 */
  --text-2:    #5c6370;   /* secondary text, 6:1 */
  --text-3:    #6b727c;   /* captions, placeholders, 4.9:1 — never below 13px */
  --accent:    #1457d6;   /* links, primary buttons, focus ring, 6.2:1 on white */
  --accent-2:  #0f46b0;   /* hover/pressed */
  --ok:        #188038;   /* status text: finalized, live, healthy */
  --warn:      #9a5b00;   /* status text: stale, pending, testnet notice */
  --bad:       #c62828;   /* status text: error, dispute, slashed */
  --ok-bg:     #ecfdf3;  --warn-bg: #fef7e6;  --bad-bg: #fdecec;  /* badge fills only */
}
```

No other colour literal may appear in any CSS, SVG or canvas on the landing site, the explorer or the docs theme. Keep the existing colour-literal test and point it at this list. Semantic colours are for status text and badges only — never for decoration, headings or charts.

### 2.2 Type

- Sans for everything: **Inter** (variable), self-hosted from `@fontsource-variable/inter` (already a devDependency). Weights used: 400, 500, 600. Nothing else.
- Mono only for hashes, addresses, block numbers inside tables, and code: **JetBrains Mono** 400 from `@fontsource/jetbrains-mono` (already a devDependency). Never for labels, headings, nav or body copy.
- Remove Source Serif 4 and IBM Plex Mono from `package.json`, `sync-chrome.mjs`, the preload tags and every CSS reference.

The scale — the only sizes allowed (desktop / ≤ 640 px), all with `letter-spacing: normal` except display:

| token | size / line-height | weight | use |
|---|---|---|---|
| `--display` | 56 / 1.1 (40 / 1.15 mobile), tracking −0.02em | 600 | home hero only |
| `--h1` | 40 / 1.2 (32 mobile) | 600 | page titles |
| `--h2` | 28 / 1.25 (24 mobile) | 600 | section titles |
| `--h3` | 20 / 1.35 (18 mobile) | 600 | card and panel titles |
| `--lead` | 18 / 1.6 | 400 | hero sentence, page intros |
| `--body` | 16 / 1.6 | 400 | everything else; measure 65ch max |
| `--small` | 14 / 1.5 | 400/500 | nav, table cells, buttons, captions |
| `--caption` | 13 / 1.5 | 400 | table headers, footnotes, timestamps |
| `--stat` | 32 / 1.1 (28 mobile), `font-variant-numeric: tabular-nums` | 600 | stat values |
| `--mono` | 14 / 1.5 | 400 | hashes, addresses, code |

Sentence case everywhere: headings, buttons, labels, table headers, nav. `text-transform: uppercase` and non-zero `letter-spacing` may not appear in any stylesheet (add this to the chrome test).

### 2.3 Space, grid, shape

- Spacing scale, the only values for margin, padding and gap: 4, 8, 12, 16, 24, 32, 48, 64, 96 px (`--s-1` … `--s-9`). Section padding: 96 top/bottom on desktop, 64 on mobile. Keep `landing/scripts/check-layout.mjs` and update its scale list to these values; it must stay clean at 1440 and 390 on every page.
- Container: `max-width: 1120px; padding-inline: 24px; margin-inline: auto`. Reading column (docs articles, long text): `max-width: 720px`.
- Grid: CSS grid, 12 columns, 24 px gap, collapsing to 1 column below 640 px and 6 below 960 px.
- Radius: 8 px on buttons, inputs, cards and callouts; 4 px on badges, code and table thumbnails; nothing fully rounded except the live dot.
- Elevation: none. The only shadow is on an open menu or dropdown: `0 2px 8px rgba(0,0,0,.12)`.
- Borders are 1 px `--border`. No 2 px rules, no dotted leaders, no double outlines.

### 2.4 Motion

`transition: color .15s, background-color .15s, border-color .15s` on interactive elements, and nothing else. No entrance animations, no scroll-triggered reveals, no number tweens, no canvas animation, no pulsing. Live values replace their text in place. `prefers-reduced-motion` needs no special handling because there is no motion to reduce.

### 2.5 Icons and imagery

A single inline SVG set, 20 px, 1.5 px stroke, `currentColor`, drawn by you: search, menu, close, external-link, copy, check, chevron-right, chevron-down, arrow-right, warning, info. Nothing else. No icon libraries, no illustrations, no photos, no abstract art, no logos other than the wordmark. One static SVG diagram is allowed on the home page (§5.1, step 3) — boxes, arrows and words in the tokens above.

---

## 3. Components

Build these once in `landing/src/chrome/` (templates in `templates.mjs`, styles in `chrome.css`) and use them unchanged on the landing site, the explorer (`explorer/src/chrome-templates.ts` mirrors the same markup and class names) and the docs theme. The chrome is still synced by `landing/scripts/sync-chrome.mjs`; keep that mechanism and its drift test.

- **Header** — 64 px, white, 1 px bottom border, sticky. Left: wordmark "Scalar Commons" (Inter 600, 18 px, plain text, links home). Centre-left: nav links in `--small` 500, `--text-2`, current page `--text` with a 2 px `--accent` underline sitting on the bottom border. Right: a GitHub link (icon + "GitHub") and one primary button **Get started** → `/docs/guide/run-an-agent`. Below 960 px: wordmark, the primary button, and a menu button (icon + "Menu") that opens a full-width panel listing the same links at 48 px row height. No horizontally scrolling nav row, no "as built" pill, no sources toggle, no ⌘K, no block counter in the header.
- **Footer** — top border, `--bg-2`, four link columns (Product: Home, Network, Explorer, Faucet · Developers: Docs, Run a node, Run an agent, Run a validator, SDK, Privacy demo · Project: GitHub, Releases, Constitution, Security · Network: Public RPC `wss://rpc.scalarnet.io`, REST API `https://api.scalarnet.io/v1`, Chain spec (download)). Every footer link opens a page or a GitHub page a person can read; none opens raw JSON or a `.rs` source file. "Constitution" goes to a docs reference page that explains the constitution pallet in words (write it, one screen, numbers as placeholders) and links the source from there; "Security" goes to the repo's security disclosure document on GitHub (create `SECURITY.md` with the posture record's public summary if none exists). Below the columns, one caption line: "Testnet — tokens have no value and the chain may be reset. Runtime {{specName}} {{specVersion}}. Page built {{date}} from block {{height}}." Those figures come from `chain-facts.json` like every other number.
- **Button** — primary (filled `--accent`, white text), secondary (white, 1 px `--control` border), text (accent, with arrow-right). Height 40, padding 0 20 px, `--small` 500, radius 8. One primary button per section at most. Disabled: 50 % opacity, no pointer.
- **Link** — `--accent`, no underline at rest, underline on hover and focus. External links get the external-link icon and `rel="noopener"`; they open in the same tab (a visitor can middle-click).
- **Card** — white, 1 px border, radius 8, padding 24. Title `--h3`, body `--body` or `--small`, optional text button. No icons in cards. Cards sit in a 3-column grid (1 on mobile) and every card in a row has the same structure.
- **Stat** — label in `--caption` `--text-2` above a value in `--stat`; optional caption below in `--caption` ("Updated 4 s ago", "of 8 seats"). Stats sit in a 4-column grid (2 on mobile) with a 1 px border between cells, not in separate boxes.
- **Table** — full width, `--small`, header row in `--caption` 500 `--text-2` on `--bg-2`, 1 px row borders, 12 px 16 px cell padding, numbers right-aligned with tabular figures, hashes and addresses in `--mono` truncated to `0x1234…abcd` / `5FxmB…8GduiA` with the full value in `title` and a copy button on hover, relative times ("4 min ago") with the absolute UTC time in `title`. Below 640 px, tables scroll horizontally inside their own container (`overflow-x: auto`), never the page.
- **Badge** — `--caption` 500, 2 px 8 px padding, radius 4, tinted fill with the matching status text colour. Only for status words: Live, Finalized, Pending, Stale, Dispute, Slashed, Operator-run, Testnet.
- **Tabs** — text in `--small` 500 with the same 2 px accent underline as the nav; `role="tablist"`; the active tab is in the URL (`?tab=` or a path) so it can be linked.
- **Search field** — 44 px, 1 px `--control` border, search icon, placeholder in `--text-3`; the explorer's accepts block number, block hash, extrinsic `block-index` or account address and goes to the matching page or a clear "Nothing found" page.
- **Code block** — `--bg-2`, `--mono`, 16 px padding, radius 8, a copy button top-right. No syntax colours.
- **Callout** — 1 px border, left 3 px border in the status colour, 16 px padding; variants info (`--accent`), warning (`--warn`), error (`--bad`). Used for the testnet notice, known issues and errors.
- **Pagination** — "Previous" and "Next" secondary buttons plus "Showing 1–20 of 989,474" in `--caption`.
- **Empty state** — one sentence in `--text-2` inside the table or panel, e.g. "No disputes are open." Never a page of zeros with boxes.
- **Loading** — neutral skeleton bars in `--bg-2` the size of the value they replace; no spinners, no "connecting…" text in the header.
- **Error state** — a warning callout with the plain cause: "Can't reach the node (wss://rpc.scalarnet.io). Values are from {{time}}." Never a blank figure, never a silent zero.
- **Address / hash** — `--mono`, truncated as above, copy button, linked to the explorer.

---

## 4. Information architecture

Primary navigation, in this order, and nothing else: **Network · Explorer · Docs · Faucet** — plus GitHub and the Get started button.

| today | after |
|---|---|
| `/` home | `/` home, rebuilt (§5.1) |
| `/observatory` | `/network` — the single live page (§5.2). `/observatory` serves a redirect page to `/network` (meta refresh + link). |
| `/pulse` | removed. `/pulse` redirects to `/network#activity`. Delete `landing/src/pulse*`, its tests, `force-graph`/`gsap` if still present. |
| `/oversight` | kept at its URL, unchanged in data and claims, restyled with the new chrome, **removed from the nav and the footer's first column**; linked from Docs → Reference → "Message privacy: what an operator can read" and from the footer's Developers column as "Privacy demo". Its 20,000-px page gets a table of contents at the top and collapsible message groups. |
| `/faucet` | `/faucet`, a working form (§5.3) |
| `/404` | the 404 page, plain (§5.4); also wire nginx `error_page 404 /404.html` in `deploy/public/nginx/scalar-commons.conf.template` so unknown paths show it instead of the bare server page |
| `/docs/` | VitePress default theme with our tokens (§5.6) |
| `explorer.scalarnet.io` | rebuilt (§5.5), same chrome as the site |
| header pill "as built", "sources" toggle, ⌘K palette, presenter mode, fullscreen | removed. The build date and block move to the footer line. Sources become a plain section at the bottom of `/network` (§5.2 step 8). |

---

## 5. Pages

Every page: one `<h1>`, `<main>`, `<header>`/`<footer>` landmarks, a visible skip link, `<title>` "Page — Scalar Commons", a meta description, an `og:title`/`og:description`/`og:image` (regenerate one neutral 1200×630 image: white, wordmark, one line), a canonical URL, `lang="en"`, a favicon. Focus rings: 2 px `--accent` outline with 2 px offset on every interactive element (`:focus-visible`).

### 5.1 Home `/`

Sections, in order, each a `<section>` with an `<h2>` except the hero:

1. **Hero** (no band, no image): eyebrow-free. `--display` headline, max 8 words, one line of meaning: *"Coordination infrastructure for autonomous AI agents"* is acceptable as is. One `--lead` sentence under it: *"A sovereign blockchain where AI agents register, agree on work, hold funds in escrow and get paid for what they deliver."* Two buttons: primary **Get started** (→ docs run-an-agent), secondary **View the network** (→ `/network`). Under the buttons a single caption with a Testnet badge: "Public testnet · runtime {{specName}} {{specVersion}} · {{validators}} validators". Nothing else in the hero — no readings column, no block strip, no curve.
2. **Network right now** — a 4-stat row: Block height, Finalized, Registered agents, Era progress ("{{elapsed}} of {{eraBlocks}} blocks"). Values from `chain-facts.json` at build time, refreshed in the browser from the public RPC/indexer every 12 s with "Updated n s ago" under the row. One text button: "See the network →".
3. **How it works** — three numbered steps in a 3-column grid, each a `--h3` and two sentences: **Register** (an agent stakes CMN and publishes what it can do; heartbeats prove it is alive), **Agree and escrow** (a buyer locks the fee in on-chain escrow; the provider delivers; the buyer confirms or disputes), **Get paid** (confirmed work settles; each era the emissions pallet pays agents for verified work, not for stake). One static SVG diagram under the three steps: three boxes and two arrows, same words. Sentences keep every number as a `{{placeholder}}`.
4. **What's on chain** — a two-column table (name · what it does) of the seven runtime modules in plain English, no pallet jargon in the left column: Agents, Escrow, Oracle, Orchestrator, Emissions, Messages, Parameters & constitution. Right column one sentence each, numbers as placeholders ("an orchestrator may keep up to {{fee}} of a sub-agent's fee"). Below the table one text button "Read the reference →" (docs).
5. **Token** — a 2-column key/value table: Symbol, Decimals, Supply cap, Genesis mint, Era length, Minimum agent stake, Registration fee, Unstake cooldown — all placeholders — followed by one `--body` paragraph that states the thesis plainly: "Emissions reward verified work. Stake sets the floor for participation; it does not earn by itself." (keep the existing weight-formula caveat about the oracle term as one sentence in `--text-2`).
6. **Status and known issues** — a warning callout: testnet, no value, may be reset; and the economic-gate paragraph that exists today, shortened to three sentences and ending with a text link to the Network page. This section is honest and boring; that is the point.
7. **Build on it** — three cards: Run an agent, Run a validator, Use the SDK — one sentence each and a text button to the docs page. Plus a fourth row of two plain links: Public RPC `wss://rpc.scalarnet.io`, REST API `https://api.scalarnet.io/v1`.
8. Footer.

Total words on the page excluding tables: under 450. The current page has about three times that.

### 5.2 Network `/network` (replaces Observatory and Pulse)

Page title "Network". Intro sentence: "Live figures read from the public node and the indexer. Every figure names its source at the bottom of the page."

1. **Status row** — stats: Block height · Finalized · Validators ("{{n}} of {{seats}}") · Era ("{{era}} · {{elapsed}} / {{eraBlocks}} blocks") · Registered agents ("{{n}}, {{operator}} operator-run") · Open disputes · Open agreements · Messages sent. Eight stats, two rows of four (two columns on mobile). "Updated n s ago" caption; a warning callout appears above the row if the node is unreachable or the figures are older than 60 s.
2. **Validators** — table: #, Account (mono, linked to explorer), Status (Active / Queued badge), Blocks authored (last {{n}} blocks), Last block. Data as the validator ring reads today (`Session.Validators`, `Babe.Authorities`, block authors). No ring.
3. **Recent blocks** — table of the last 12: Block, Age, Author, Extrinsics, Finalized badge; updates in place. Link "Open in explorer".
4. **Activity** (`id="activity"`) — table of the last 25 agent events (registrations, heartbeats, agreements, disputes, oracle answers, slashes): Time · Event (plain words: "Agreement opened", not `escrow.AgreementOpened`) · Agents · Details, with filter chips (All · Agreements · Disputes · Messages · Registrations · Slashes) and a text button to the explorer's activity page. Empty state: "No agent events in the last hour. Last one at block {{n}}."
5. **Emissions** — stats: Issued so far · Supply cap · Last era emission · Next settlement (block and ≈ time); plus a 2-column table of the current era's parameters. No curves, no waterfalls.
6. **Agents** — stats: Registered · Active (heartbeat within grace) · In dispute · Slashed last hour; and a table of the 10 most recently registered (Name/address, Registered at block, Operator-run badge, Status). No ember field, no force graph.
7. **Runtime history** — a plain table from `runtime-history.json`: Spec, Block, Date, Note.
8. **How these figures are read** — a table: Figure · Source (`pallet.storage` or indexer route) · Last read (block, UTC). This replaces the sources toggle, the tooltips and the raw links.

### 5.3 Faucet `/faucet`

Title "Faucet". One sentence: "Get {{dripAmount}} test CMN for an address on the public testnet. One request per address and per IP address every hour. Tokens have no value." Then the form: label "Your address (SS58)", a 44 px input, primary button **Request test CMN**. Inline validation (address format, with the plain error under the field). On success a success callout: amount, the extrinsic hash linked to the explorer, "Next request for this address: {{interval}} from now". On failure the API's message in an error callout. Below the form a collapsed `<details>` "Use the API instead" with the two curl commands. Nothing else on the page.

The form works only once the faucet answers with CORS headers. Add to `deploy/public/nginx/scalar-commons.conf.template`, in the faucet vhost, `add_header Access-Control-Allow-Origin "https://scalarnet.io" always;` and the `OPTIONS` preflight handling (`Access-Control-Allow-Methods "POST, GET, OPTIONS"`, `Access-Control-Allow-Headers "content-type"`, `return 204` for OPTIONS). This is a config template, not CI — it is in scope. Until the operator reloads nginx the page shows a warning callout: "The faucet is temporarily unavailable from this page; use the API below." Detect this by the fetch failing, not by a hard-coded flag.

### 5.4 Not found `/404`

"Page not found" as `--h1`, one sentence ("There's nothing at {{path}}."), two links: Home, Docs, and the docs search field. Nothing else; the nginx `error_page` rule serves it.

### 5.5 Explorer `explorer.scalarnet.io`

Same header and footer as the site (Explorer current). The explorer keeps reading the node directly for single items and may read the indexer (`https://api.scalarnet.io/v1`, routes in `indexer/src/api.ts`) for lists and search; each page's footer caption names what it read ("Read from the node at block {{n}}", "List from the indexer, {{n}} s ago").

- **Home `/`** — a search field as the first element under the header, full container width, placeholder "Search by block number, block hash, extrinsic (block-index) or address". Under it a 4-stat row (Block height, Finalized, Registered agents, Last era emission). Then two columns: **Latest blocks** (10 rows: Block, Age, Author, Extrinsics, Finalized) and **Latest activity** (10 rows: Time, Event, Agent), each with a "View all →" link. The chain facts (chain name, spec, token, SS58, genesis hash) move to a small "About this chain" key/value table at the bottom.
- **Blocks `/blocks`** — paginated table (25 per page): Block, Age, Hash, Author, Extrinsics, Events, Finalized.
- **Block `/block/{n|hash}`** — breadcrumb "Explorer › Block {{n}}"; a key/value table (Number, Hash, Parent, Timestamp, Author, Finalized badge, Extrinsics count, Events count, State root); tabs **Extrinsics** / **Events**; each table in the shared component. Previous / next block buttons.
- **Extrinsic `/extrinsic/{block}/{index}`** — key/value (Block, Index, Hash, Signer, Call in plain words plus the raw `pallet.call`, Result badge, Fee if known, Nonce); then **Arguments** as a two-column table and **Events** as a table.
- **Account `/account/{address}`** — header with the full address in mono and a copy button; a stat row: Free balance, Reserved, Total (CMN with 2 decimals and the full planck value in `title`); if the account is a registered agent, an "Agent" card: name, status badge, stake, registered at block, heartbeat age, operator-run badge; then tabs **Extrinsics** / **Activity**, paginated.
- **Activity `/activity`** — the current page rebuilt on the shared table: Time (relative, UTC in title) · Block · Event (plain words with a badge for Dispute/Slash) · Agent(s) (one truncated address each, never repeated in Details) · Details (the fields that matter, in words). Filter chips as on `/network`, the agent-address filter field kept, pagination at the bottom, 25 per page. The intro sentence loses the raw counts ("Showing every agent: 989474 events…") and becomes "Agent events, newest first. History reaches back to block {{n}}."
- **Search `/search?q=`** — resolves and redirects; on no match a page "Nothing found for '…'" with the search field again and the four formats it accepts.
- **400/404/500** — a plain title, one sentence, the search field.
- Chain naming: the header shows "Scalar Commons testnet", never "Local Testnet"; the spec name/version sits in the footer line like everywhere else.

### 5.6 Docs `/docs/`

Replace the custom Ledger theme with VitePress's default theme and a `custom.css` that sets its CSS variables to our tokens (font Inter, `--vp-c-brand-1: #1457d6`, neutral greys, no dark mode: force `appearance: false` in config). Keep: sidebar (Guide / Reference), right-hand outline, local search, previous/next links, `check-chain-values.mjs`, `.chain/snapshot.json`. Docs home: a `--h1` "Documentation", one sentence, three cards (Run a node, Run an agent, Run a validator) and a plain list of reference pages. Remove the "Pages / Last checked / Snapshot drift / Watch-log" block from the home page and from the article chrome (the lint keeps running; it is not a visitor's concern). The chain spec link becomes a download link (`download` attribute) labelled "chainspec.json (download)". Articles: reading column 720 px, `--body` 16/1.6, headings on the scale, code blocks in the shared style, tables in the shared style. The scripts-off 404 band goes.

---

## 6. Words

- Sentence case. Plain English. Short sentences. Active voice. No slogans, no manifesto lines as headings, no first-person plural marketing ("we believe"), no exclamation marks.
- Define the first use of any term a visitor may not know, inline and briefly: "an era (the {{hours}}-hour reward period)".
- Numbers: thousands separators; units always ("1,234 blocks", "1,000 CMN"); money never with more than 2 decimals in tables (full precision in `title`). Dates "23 Oct 2026, 11:32 UTC"; relative times "4 min ago" for anything under a day. Percentages from basis points shown as "5 %".
- Labels name the thing, not the instrument: "Validators", not "Validator ring"; "Activity", not "Pulse"; "Network", not "Observatory".
- Every chain figure in prose stays a `{{placeholder}}` resolved from `chain-facts.json`; the claims test (`landing/test/claims.test.mjs`) keeps forbidding literal digits in `content.mjs` and must stay green. Words like "eight validators" count as digits — write "{{validators}} validators".

---

## 7. Live data rules

- Build-time figures come from `landing/chain-facts.json`; refresh it first with `node scripts/fetch-chain-facts.mjs` against `wss://rpc.scalarnet.io` (and `fetch-chain-events.mjs`), and commit the refreshed JSON.
- In the browser: poll the indexer `/v1/status` and the RPC every 12 s while the tab is visible; replace values in place; show "Updated n s ago". If a read fails, keep the last value, mark the row Stale (warning badge) and show the warning callout with the reason. Never show zero for an unknown. Never animate a change.
- Nothing hand-typed: a count, a date or a hash appearing in markup must come from data; the existing tests enforce this for the landing site — extend the same check to the explorer templates.
- Budget: home page ≤ 150 KB transferred and one plain script ≤ 6 KB (no bundle) for the refresh; network page ≤ 250 KB; docs article ≤ 400 KB; explorer pages ≤ 100 KB. No page may make more than 12 requests on first load. `status.json` and `posture.json` stay published and are linked only from the Network page's sources table, with the `download` attribute.

---

## 8. Delete

`landing/src/pulse*`, `landing/src/observatory/instruments/*` canvases and their CSS (replace with the tables and stats above; reuse only the data readers in `observatory/data.js`, `scale.js`, `ss58.js`, `format.js`), `presenter.js`, `motion.js`, `reveal.js`, `daybar.js`, `hour.js`, `spine.js`, `chrome/behaviour/{lamp,palette,stubs,bar,digits,fit,print}.js`, `chrome/curve.mjs`, `chrome/print.css`, every `nw-*` class, the `screenshots/` folder's obsolete PNG/GIF/WebM files (keep the folder for the new ones), the serif and Plex fonts, the three superseded brief files, and any test that tests a deleted thing. The oversight page keeps its data code (`oversight/*.js`) and loses only its styling.

---

## 9. Repo facts you must respect

- Static landing: `landing/scripts/build.mjs` → `dist/` (`LANDING_OUT_DIR` on the host); pages are `index.html`, `network.html`, `faucet.html`, `404.html`, `oversight.html`, plus `observatory.html` and `pulse.html` as redirect stubs. nginx serves `try_files $uri $uri/ $uri.html`, so `/network` → `network.html`. Keep the build dependency-free except esbuild for the network page's one script and the oversight page.
- Docs build with `DOCS_BASE=/docs/`; explorer is a Node service on the host (port 8081) with `EXPLORER_RPC_ENDPOINT`; faucet is a JSON API only.
- The host timer `deploy/products/redeploy-on-merge.sh` rebuilds landing and docs after a merge to master. The explorer is **not** rebuilt by it — say so in the PR body (Appendix B).
- Tests: `cd landing && npm test`; `cd explorer && npm test`; `cd docs && node scripts/check-chain-values.mjs`; `node landing/scripts/check-layout.mjs` with live data at 1440 and 390. All green before every push.
- No CI/CD: nothing under `.github/`. Config templates under `deploy/public/nginx/` may be edited only for the CORS headers and the 404 `error_page` rule in §5.3–5.4; everything else under `deploy/` is untouched.
- Git: branch `site/plain-redesign` from `master`; one commit per phase below; never force-push; open the PR at the end with the evidence in §10.

---

## 10. Order of work and evidence

1. `site: plain chrome` — refresh `chain-facts.json` (§7); tokens, type, components, header/footer, fonts swapped, superseded briefs deleted, tests updated (colour list, no-uppercase/letter-spacing rule, scale list).
2. `site: home` — §5.1, copy under 450 words, claims test green.
3. `site: network` — §5.2 with live data; redirects for `/observatory` and `/pulse`; pulse deleted.
4. `site: faucet, 404` — §5.3–5.4 and the nginx template lines.
5. `explorer: plain chrome` — §5.5, all routes, search, pagination, error pages; `npm test` green.
6. `docs: default theme` — §5.6.
7. `site: oversight restyle` — chrome only, table of contents, collapsible groups.
8. Evidence: full-page screenshots of every page at 1440 and 390 with live data in `landing/screenshots/plain-*.png`; paste `check-layout.mjs` output and every test run from §9 into the PR body; a table of every nav item, button and link on every page with where it goes (there must be none that does nothing); word counts per page.

Before pushing each phase, open the screenshots and read §1 again. If anything on screen fails questions 2 or 4, remove it.

---

## Appendix A — what the audit of the live site found (each must be false afterwards)

Measured on 23 Oct 2026 with a real browser at 1440 and 390 px, clicking every control. Treat these as acceptance tests.

**Site-wide**

1. No favicon on any page; no `og:image`, no canonical URL anywhere; explorer pages have no meta description. In a browser tab and in a shared link the site is anonymous.
2. Three visual systems on one domain: the site (black, serif + typewriter), the explorer (navy, teal, system fonts), the docs (site chrome with a monospace sidebar). A visitor crossing from the home page to the explorer lands on what looks like another company's tool.
3. The header carries three controls a visitor cannot interpret — an "AS BUILT · 2026-10-23" pill, a "SOURCES" switch, and a "⌘K" chip — and no action. Clicking "SOURCES" on the home page changes nothing visible; "⌘K" is a `<span>`, not a button, so it cannot be focused or clicked; on a phone it is still shown and means nothing.
4. The nav has six items in uppercase 12 px tracked mono; on a phone it is a horizontally scrolling strip that cuts "OVERSIGHT" to "OVERSIGH" and sits under an unlabelled toggle. The tap targets are 12 px tall (text height, no padding) — the recommended minimum is 44 px.
5. Every live figure ends in a white or outlined square. It reads as a rendering glitch or a cursor. It is in fact a button ("show the source"), with nothing to say so — 16 such buttons on the home page, dozens on the observatory.
6. All-caps tracked labels everywhere: 53 on the home page, 95 on the observatory, 464 on the oversight page. Two typefaces (Source Serif 4 for text, IBM Plex Mono for labels, figures, nav and captions) and 9–10 font sizes per page; on the home page the mono face carries twice as many text nodes as the serif. This is the "terminal poster" look, and it is the main reason the site reads as generated.
7. Footer links "Status" and "Disclosures" open raw JSON files (`/status.json`, `/posture.json`); "Constitution" opens a Rust source file (`pallets/constitution/src/lib.rs`) on GitHub; "Evidence" opens a GitHub directory. A footer link should open a page a person can read.
8. Unknown paths (`/nope`) return nginx's bare "404 Not Found"; the designed 404 page is only reachable at `/404`.
9. Pages are enormous: home 6,222 px (9,034 on a phone), observatory 7,882 (12,925), oversight 20,739 (36,306), the run-a-validator doc 18,033 (24,424) with a horizontal overflow on a phone (394 px wide at 390). Word counts: observatory 3,916, oversight 2,470.

**Home**

10. No primary action. There is no "Get started", "Read the docs" or "Run an agent" button on the page; the first link below the hero is "15 calls ›", which expands a list of extrinsic names.
11. The hero's right half is three figures with squares — "ERA 172 · 311 / 3,600" is unreadable to anyone who does not already know what an era is — followed by a "BLOCKS ARRIVING NOW" strip of vertical bars whose "FINAL · 1,161,242" label overlaps it. Decorative, and the first thing a visitor sees.
12. "Stake alone earns nothing." as a 96 px line, with a faint diagonal curve crossing the page: a poster, not a product page.
13. "What the chain does" lists pallets (agents, escrow, oracle, orchestrator, emissions, messages, auto-params · constitution) with "15 calls ›" links. A visitor is shown the runtime's internal module names.
14. Four 600-word blocks a visitor does not need on a home page: a formula (`weight = √stake × rank × …`), four small curves with Rust file paths under them, a nine-line paragraph about a FAILED economic gate, and "How to check any of this" — Rust `const` snippets with "10 more ›".
15. "Where to go next" shows bare URLs in mono (`scalarnet.io/docs`, `github.com/tejaspatil1936/scalar-commons-v4`) with squares after them instead of buttons or cards with a sentence.
16. The copy uses "era" 11 times, "runtime" 12, "emission" 8, "stake" 8, "pallet" 6 — none defined.

**Observatory**

17. Numbers at 80 px with squares; "OPERATOR-RUN 140 OF 204" has the "OF 204" at a third of the size and the square floating beside it; "≥ 696" for agreements open. Every headline figure is a link, and clicking it opens the raw JSON of the API response in a new tab ("1,165,297 (raw response, opens in a new tab)"); the "confirmed on chain" links in the upgrade history do the same.
18. "Activity in the last hour": five zeros, each with a box — a dead-looking page. The activity feed, pulse and ember field all show nothing because the swarm is quiet; the design has no empty state other than zeros.
19. The ember field ("one ember per agent… an ember's ink is the agent's heartbeat multiplier") and its five-symbol legend; the validator ring with a 12 px mono run-on legend ("lit point, 'sealing now': sealed the latest block · ticks around a point: the last 12 finality rounds sampled…"); provenance blocks in 12 px mono listing RPC method names. These explain the instrument, not the network.
20. 205 clickable elements on one page; a "Present" mode; "Network graph" / "The same agents as a list" toggles; 4 running animations; a second "Blocks arriving now" strip. 9-second load with 32 requests.
21. Accessibility: `<li>` outside any list (8), duplicate banner landmark, content outside landmarks, `aside` nested in a landmark.

**Pulse**

22. The page is empty: three zeros, a blank waterfall area, a legend of six event glyphs for events that are not occurring, "F fullscreen". A visitor sees a broken page. There is nothing here that the observatory and the explorer's activity page do not already cover.

**Oversight**

23. A 20,739 px research record sits in the primary nav beside Docs. Its header shows "CONNECTING · WSS://RPC.SCALARNET.IO" jammed against "SOURCES", then "OFFLINE — SHOWING RECORDED VALUES". The page tries to connect to `http://127.0.0.1:9966/` from production (two `ERR_CONNECTION_REFUSED` console errors).
24. 36 colour-contrast failures (axe, serious) and 2 critical ARIA structure failures on this page alone; 464 uppercase labels.

**Faucet**

25. Broken: the headline "test CMN," is positioned over the AMOUNT / INTERVAL labels, both readings are empty boxes, there is no address field and no button. The page explains "This page cannot read faucet.scalarnet.io from this origin: the faucet's answers carry no cross-origin permission" and offers two curl commands. The console confirms the CORS failure on `/health`. The one page a newcomer needs does not work in a browser.

**Docs**

26. Docs home leads with "Read, then run." and three vanity figures — "PAGES 11", "LAST CHECKED AGAINST THE NODE block 1,157,827", "SNAPSHOT DRIFT 0 PAGES" — and a "watch-log", before any guide is listed.
27. Every article carries a "checked against spec 309 · block … · 0 drift" box and repeats its intro sentence twice (lead, then first paragraph). The sidebar and outline are monospace; "On this page" sits in the left sidebar under the nav instead of on the right, leaving the right third of a 1440 px screen empty.
28. The "chain spec" link opens a 195,000 px raw JSON page in the browser rather than downloading the file. Docs pages weigh 780–860 KB each.

**Explorer**

29. Home has no search field, no latest blocks and no activity — a chain-facts table and one link. The chain is named "Scalar Commons Local Testnet" on a public testnet.
30. Activity reloads itself every 12 s (`<meta http-equiv="refresh">`), which throws away scroll position and the filter while a visitor is reading; axe rates it critical. Rows show raw ISO timestamps ("2026-10-23T17:30:54.000Z"), `agents.HeartbeatSent`, "1164834-1", and the same full address twice per row (Agents, then "who:" in Details). The intro says "Showing every agent: 989474 events".
31. Block page: "Block 1165185" without separators, raw ISO time, no author, no finalized state, no events, no previous/next, no breadcrumb. Account page: balances to twelve decimal places ("1,084.514632607691 CMN"), no agent information, no activity, not even a link to this address's activity.
32. No favicon, no description, no link back to the site, no footer navigation, a different palette and font from everything else.

## Appendix B — operator steps after merge (put this in the PR body verbatim)

1. Landing and docs republish by the host timer within ~10 minutes of the merge.
2. The explorer is a separate service and does not redeploy itself. In the repo checkout on the host: `git pull && cd explorer && npm ci && npm run build && systemctl --user restart scalar-explorer.service`.
3. Apply the nginx template changes (faucet CORS headers, `error_page 404`) to the live config and `nginx -s reload`; the faucet form works from that moment.
4. Optional: `fetch-chain-facts.mjs` on the host before the landing build keeps the footer's build block current.
