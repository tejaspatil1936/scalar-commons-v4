# landing — the public Scalar Commons site

The static site at scalarnet.io: the home page, `/network` (the one live
page), `/faucet`, `/oversight` (the message-privacy record) and the 404 page,
all on one plain, light design system (`SITE-REDESIGN.md` at the repo root is
the brief and the standard). No framework. The home page ships one small
script that refreshes four figures; `/network` ships one bundled script;
`/faucet` and `/oversight` each ship their own; nothing else runs in the
browser.

```sh
npm ci --no-audit --no-fund
npm run build          # -> dist/: index.html, styles.css, network.html, faucet.html, 404.html, oversight.html, …
npm test               # the honesty suite and the chrome rules (below)
```

Serve `dist/` with anything that serves files; nginx maps `/network` to
`network.html` with `try_files $uri $uri/ $uri.html` and unknown paths to
`404.html` with `error_page 404 /404.html`.

## The rule this directory is built around

A site is where a chain's claims get quoted back at it. So **no chain figure on
any page is written by hand.** Every number comes out of the runtime metadata
of a running node or out of a live read in the browser, and every sentence
about mechanism is pinned to the line of runtime source that implements it.

That is enforced, not aspirational:

| File | What it holds |
|---|---|
| `chain-facts.json` | Generated. Constants, pallet indices, extrinsic names, token properties and a state snapshot, read off a live node with `@polkadot/api`. Carries the spec version, genesis hash and block it was read at. |
| `src/content.mjs` | The home page's words. Prose may contain **no literal digits** — figures appear only as `{{path.into.chain-facts\|filter}}` placeholders. |
| `src/source-claims.mjs` | Each mechanism sentence's backing: the `file` + `line` of runtime source it is pinned to. |
| `src/render.mjs` | Pure `facts + content -> HTML` for the home page, on the chrome. Throws on an unresolved placeholder or an unpinned claim, so the build fails rather than ship a figure no node reported. |
| `src/home/refresh.js` | The home page's one script (plain, no bundle): the four live stats, "Updated n s ago", the stale state. |
| `src/network.mjs`, `src/network/` | `/network`: the frame built at build time, and the script (`network.js`) that fills every figure from the public node and the indexer and names each figure's source in the page's last table. |
| `src/faucet.mjs`, `src/faucet/` · `src/notfound.mjs` · `src/oversight.mjs`, `src/oversight/` | The faucet form, the 404 page and the oversight record, each built by its own module under `scripts/pages/`. |
| `src/chrome/` | The design system: `tokens.css` (the only colours, sizes, spacing steps and radii), `fonts.css` (Inter, JetBrains Mono), `chrome.css` (every component), `templates.mjs` (the same components as string templates), `behaviour/` (copy buttons). Shared verbatim with `docs/` and `explorer/` by `scripts/sync-chrome.mjs`. See `src/chrome/README.md`. |

`npm test` (`node --test`) checks that every placeholder resolves, that prose
carries no hand-typed digits, that every module and extrinsic the pages name
exists in the committed metadata, that every pinned claim is still at its line,
that a fixed list of unearned marketing claims never appears, that the chrome
copies are byte-identical, that no stylesheet on any surface uses a colour
outside the tokens, an uppercase transform, a letter-spacing, a spacing value
off the scale, a font off the type scale, or any animation — and that each
page's markup is what its tests describe.

`scripts/check-layout.mjs` opens every page at 1440 and 390 px with live data
and fails on overlap, overflow, a horizontal scroll, or a value off the scales
(read its header for the flags; it needs the site, the docs and the explorer
built).

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

`verify:chain` exits non-zero if any **metadata** fact drifted: that means a
page is stating something the runtime no longer does. Moving chain **state**
(block height, agent count, issuance) is reported as drift but does not fail —
the pages label those figures as a snapshot at a named block, and `/network`
reads them live.

If the node is unreachable, all three scripts fail loudly. That is deliberate: an
unreachable node is a finding, not a reason to guess at a number.

## Caveats the home page carries on purpose

- **The oracle-accuracy term is inert.** It is in the weight formula and can add
  up to the `oracleBonusBps` maximum, but the runtime wires
  `type OracleScoreProvider = ();`, so it contributes zero today. A test asserts
  the disclosure stays as long as that line does.
- **The economic gate failed, and the re-measurement is pending.** The fix (an
  era's pool bounded by the qualifying escrow volume it settled) is in the
  running runtime, which the page names from the same live metadata as every
  other figure; it is not the proof, and no re-measurement has been published.
- **The chain may be reset and tokens have no value.** Every page's footer says
  so.

When any of them changes, update `src/content.mjs`; only the first is test-pinned.

## The public endpoints

Everything the pages link and read is public and live: the RPC at
`wss://rpc.scalarnet.io` (JSON-RPC over HTTPS at `https://rpc.scalarnet.io`),
the indexer at `https://api.scalarnet.io/v1`, the explorer at
`https://explorer.scalarnet.io` and the faucet at `https://faucet.scalarnet.io`.
