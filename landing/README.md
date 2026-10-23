# landing — the public Scalar Commons site

The static site at scalarnet.io: the home page, `/network` (the one live
page), `/faucet`, the 404 page and `/oversight`, all on one plain, light
chrome shared with the docs and the explorer (SITE-REDESIGN.md). No
framework. `/observatory` and `/pulse` are redirect pages to `/network`.

```sh
npm ci --no-audit --no-fund
npm run build          # -> dist/: every page, styles.css, the scripts, fonts, favicon, og.png
npm test               # the honesty suite and the chrome rules (below)
```

Serve `dist/` with anything that serves files; nginx maps `/network` to
`network.html` and unknown paths to `404.html`.

## Pages

| Page | Built from | Script |
|---|---|---|
| `/` | `src/render.mjs` + `src/content.mjs` + `src/home.css` | `home.js`: `src/home/refresh.js` minified, never bundled (under 6 KB); refreshes the four live stats from the indexer every 12 s while the tab is visible |
| `/network` | `scripts/pages/network.mjs`, `src/network.mjs`, `src/network/` | `network.js` (esbuild): status, validators, recent blocks, activity, emissions, agents, read from the indexer and the RPC every 12 s |
| `/faucet` | `scripts/pages/faucet.mjs`, `src/faucet.mjs`, `src/faucet/` | `faucet.js`: the form, SS58 checking, the drip request |
| `/404` | `scripts/pages/notfound.mjs`, `src/notfound.mjs`, `src/notfound/` | `404.js`: search over the docs and the site's pages |
| `/oversight` | `scripts/pages/oversight.mjs`, `src/oversight.mjs`, `src/oversight/` | `oversight.js`: the table of contents, collapsible message groups, copy and verify |
| `/observatory`, `/pulse` | `scripts/pages/redirects.mjs` | none: a meta refresh and a link |

Every live figure keeps its last value when a read fails, is marked Stale
and carries a warning callout with the plain cause; nothing shows a zero
for an unknown, and nothing animates.

## The rule this directory is built around

A website is where a chain's claims get quoted back at it. So **no chain
figure on these pages is written by hand.** Every number comes out of the
runtime metadata of a running node, and every sentence about mechanism is
pinned to the line of runtime source that implements it.

That is enforced, not aspirational:

| File | What it holds |
|---|---|
| `chain-facts.json` | Generated. Constants, pallet indices, extrinsic names, token properties and a state snapshot (including the genesis mint), read off a live node with `@polkadot/api`. Carries the spec version, genesis hash and block it was read at. |
| `src/content.mjs` | The home page's words. Prose may contain **no literal digits** — figures appear only as `{{path.into.chain-facts\|filter}}` placeholders. |
| `src/source-claims.mjs` | Each descriptive claim (`weight starts from the square root of stake`) with the `file` + `snippet` that backs it; every mechanism sentence in `content.mjs` names the rows that back it. |
| `src/render.mjs` | Pure `facts + content -> HTML`, on the chrome. Throws on an unresolved placeholder, so the build fails rather than ship a figure no node reported. |
| `src/chrome/` | The plain chrome: `tokens.css` (the only colours, sizes, spacing steps and radii), `fonts.css` (Inter, JetBrains Mono), `chrome.css`, `templates.mjs` and `behaviour/` (copy buttons). Shared verbatim with `docs/` and `explorer/` by `scripts/sync-chrome.mjs`. See `src/chrome/README.md`. |
| `scripts/pages/` | Every page but the home page, each built by its own module after the core build. |

`npm test` (`node --test`) checks that every placeholder resolves, that prose
carries no hand-typed digits, that every pallet and extrinsic the page names
exists in the committed metadata, that every source claim's snippet is still
present in the repo, that a fixed list of unearned marketing claims (yield
figures, sales, audits, halvings) never appears, and that docs, explorer,
faucet and repo are all linked. `test/network.test.mjs` renders `/network`
from altered data and fails on any figure that does not follow it.
`test/chrome.test.mjs` holds the chrome copies byte-identical, every colour
to the token list, no uppercase or letter-spacing outside the display
headline, every spacing value and font on the scales, and the deleted
Ledger chrome, fonts and pages gone.

`scripts/check-layout.mjs` opens every page (the site, the docs and the
explorer, with live data) at 1440 and 390 px and fails on overlapping
stats, a value wider than its cell, horizontal scroll, off-scale type or
spacing, a colour that is not a token, or uppercase / letter-spacing. Build
the landing site, the docs (`DOCS_BASE=/docs/`) and the explorer first;
Playwright comes from the global install and is in no package.json.

The build is dependency-free except `esbuild`, which bundles the scripts of
`/network`, `/faucet`, `/404` and `/oversight` (each one file, no chunks).
`@polkadot/api` is a devDependency used only by the chain scripts, never by
`npm run build`.

## Refreshing the chain facts

Point the scripts at the public RPC (without an argument `fetch:chain-facts`
looks for a local dev node on the loopback address, `verify:chain` uses the RPC
the committed record names, and `fetch:chain-events` uses
`https://rpc.scalarnet.io`):

```sh
npm run fetch:chain-facts -- wss://rpc.scalarnet.io   # rewrite chain-facts.json
npm run verify:chain -- wss://rpc.scalarnet.io        # re-check the committed facts against the live node
npm run fetch:chain-events                            # rewrite chain-events.json over HTTPS (https://rpc.scalarnet.io)
```

`verify:chain` exits non-zero if any **metadata** fact drifted: that means the
page is stating something the runtime no longer does. Moving chain **state**
(block height, agent count, issuance) is reported as drift but does not fail —
the page labels those figures as a snapshot at a named block.

If the node is unreachable, all three scripts fail loudly. That is deliberate: an
unreachable node is a finding, not a reason to guess at a number.

## Caveats the page carries on purpose

The page discloses three things rather than glossing them:

- **The oracle-accuracy term is inert.** It is in the weight formula and can add
  up to the `oracleBonusBps` maximum, but the runtime wires
  `type OracleScoreProvider = ();`, so it contributes zero today. A test asserts
  the disclosure stays as long as that line does.
- **The economic gate failed, and the re-measurement is pending.** The fix (an
  era's pool bounded by the qualifying escrow volume it settled) is in the
  running runtime, which the caveat names from the same live metadata as every
  other figure; it is not the proof, and no re-measurement has been published.
- **The chain may be reset, and pallet weights are hand-estimated** until
  benchmarks land. The same caveat names the public RPC, `wss://rpc.scalarnet.io`.

When any of them changes, update `src/content.mjs`; only the first is test-pinned.

## The public endpoints

Everything the pages link and read is public and live: the RPC at
`wss://rpc.scalarnet.io` (JSON-RPC over HTTPS at `https://rpc.scalarnet.io`),
the indexer at `https://api.scalarnet.io/v1`, the explorer at
`https://explorer.scalarnet.io` and the faucet at `https://faucet.scalarnet.io`.
Nothing on the site is labelled `planned`; the claims test fails if a built
thing is ever advertised that way.
