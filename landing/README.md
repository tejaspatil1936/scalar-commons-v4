# landing — the public Scalar Commons site

A static marketing page: what the chain is (coordination infrastructure for
autonomous AI agents), the token model, and where to go next. No framework. The landing page itself
ships no client-side JavaScript. The one script on the site belongs to
`/observatory` (below).

```sh
npm ci --no-audit --no-fund
npm run build          # -> dist/index.html + dist/styles.css
npm test               # the honesty suite (below)
```

Serve `dist/` with anything that serves files.

## The rule this directory is built around

A landing page is where a chain's claims get quoted back at it. So **no chain
figure on this page is written by hand.** Every number comes out of the runtime
metadata of a running node, and every sentence about mechanism is pinned to the
line of runtime source that implements it.

That is enforced, not aspirational:

| File | What it holds |
|---|---|
| `chain-facts.json` | Generated. Constants, pallet indices, extrinsic names, token properties and a state snapshot, read off a live node with `@polkadot/api`. Carries the spec version, genesis hash and block it was read at. |
| `src/content.mjs` | The words. Prose may contain **no literal digits** — figures appear only as `{{path.into.chain-facts\|filter}}` placeholders. |
| `src/source-claims.mjs` | Each descriptive claim (`weight starts from the square root of stake`) with the `file` + `snippet` that backs it. Rendered into the page's verification table. |
| `src/render.mjs` | Pure `facts + content -> HTML`. Throws on an unresolved placeholder, so the build fails rather than ship a figure no node reported. |

`npm test` (`node --test`) checks that every placeholder resolves, that prose
carries no hand-typed digits, that every pallet and extrinsic the page names
exists in the committed metadata, that every source claim's snippet is still
present in the repo, that a fixed list of unearned marketing claims (yield
figures, sales, audits, halvings) never appears, and that the four required
destinations — docs, explorer, faucet, repo — are all linked with anything
unbuilt labelled `planned`.

The landing page build is dependency-free. `@polkadot/api` is a devDependency
used only by the two chain scripts, never by `npm run build`. The one bundler
in the build is `esbuild`, used only for `/observatory` (below), whose
instruments are drawn with `d3-force`, `d3-scale` and `d3-shape`.

## /observatory — the live instruments

`npm run build` also emits `observatory.html` (with its stylesheet inlined),
`observatory.js` (one esbuild bundle), `observatory.css`, `fonts/`, and the two
records the page is built with. nginx serves it at `/observatory` through
`try_files $uri.html`. The landing page states figures that were read at build
time. The observatory is its live counterpart: the build ships **no** figure in
any reading slot, and the reader's browser fetches every value from
`api.scalarnet.io`, `wss://rpc.scalarnet.io` or the GitHub API. Each value has
the endpoint and UTC fetch time printed under it, and links to the exact bytes
of the response it came from. A failed fetch shows `unavailable` and the reason,
never the previous value.

| File | What it holds |
|---|---|
| `src/observatory.mjs` | Build-time frame: one section per instrument with a plain sentence before it, empty reading slots, the upgrade rail, the posture strip, the verification commands. Also `renderSection` for the harness. |
| `src/observatory.css` | The design system: the plate, the reticle grid, the three self-hosted faces, the tokens. Each instrument's own rules live beside it in `src/observatory/instruments/<name>.css` and are appended at build time. |
| `src/observatory/` | The client. `context.js` gives every instrument one WebSocket (calls and subscriptions, paused when the tab is hidden), deduplicated polling, provenance records, motion and theme; `instruments/*.js` draw. See `src/observatory/README.md` for the contract. |
| `runtime-history.json` | The upgrade record. Each applied row carries the sha256 and blake2-256 of the on-chain `:code` at its upgrade block; the page re-confirms each block against `system.CodeUpdated` events live. |
| `public/posture.json` | The security-posture record, written by the operators. A `null` value renders as "not yet recorded"; nothing here is ever read from the chain. |

Develop one instrument on its own, against the live services:

```sh
npm run dev:instrument -- era --no-serve --out /tmp/h-era   # the harness page for one section
node --test test/instruments/era-dial.test.mjs              # its unit tests
```

`test/observatory.test.mjs` checks that no reading ships with a value, that
every instrument opens with a sentence, that every indexer route, field and
event the client reads exists in `indexer/src` and the pallets, that the two
records are labelled as records and agree with the files they cite, that no
instrument polls with `setInterval` or animates forever, and that the page
shares this site's palette. `test/observatory-lib.test.mjs` covers the SCALE
and SS58 decoders, formatting, the data layer and the hero's stream model.

When a runtime upgrade is applied, add its row to `runtime-history.json`,
including the hashes of the on-chain `:code` at the upgrade block (the
"Verify it yourself" section shows the command). When a posture value is
established, fill it in `public/posture.json` with its date.

## Refreshing the chain facts

Point at a node — the devnet RPC is loopback-bound, so run these on its host:

```sh
npm run fetch:chain-facts             # rewrite chain-facts.json from ws://127.0.0.1:9944
npm run fetch:chain-facts -- ws://…   # or from another endpoint
npm run verify:chain                  # re-check the committed facts against a live node
```

`verify:chain` exits non-zero if any **metadata** fact drifted: that means the
page is stating something the runtime no longer does. Moving chain **state**
(block height, agent count, issuance) is reported as drift but does not fail —
the page labels those figures as a snapshot at a named block.

If the node is unreachable, both scripts fail loudly. That is deliberate: an
unreachable node is a finding, not a reason to guess at a number.

## Caveats the page carries on purpose

The page discloses two things rather than glossing them:

- **The oracle-accuracy term is inert.** It is in the weight formula and can add
  up to the `oracleBonusBps` maximum, but the runtime wires
  `type OracleScoreProvider = ();`, so it contributes zero today. A test asserts
  the disclosure stays as long as that line does.
- **The devnet RPC is loopback-only.** No public endpoint yet, so the explorer
  link needs an endpoint the reader can reach, and the faucet is marked
  `planned` with a link to the issue tracking it.

When either changes, update `src/content.mjs` — the tests will tell you.
