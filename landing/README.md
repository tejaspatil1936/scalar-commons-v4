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

The build itself is dependency-free. `@polkadot/api` is a devDependency used
only by the two chain scripts, never by `npm run build`.

## /observatory — the live page

`npm run build` also emits `observatory.html`, `observatory.js` and
`observatory.css`. nginx serves it at `/observatory` through
`try_files $uri.html`. The landing page states figures that were read at build
time. The observatory is its live counterpart: the build ships **no** figure in
any reading slot, and the reader's browser fetches every value from
`api.scalarnet.io`, `wss://rpc.scalarnet.io` or the GitHub API. Each value has
the endpoint and UTC fetch time printed under it, and links to the exact bytes
of the response it came from. A failed fetch shows `unavailable` and the reason,
never the previous value.

| File | What it holds |
|---|---|
| `src/observatory.mjs` | Build-time frame: labels, explanations, empty slots, the upgrade table, the verification commands. |
| `src/observatory.js` | The only client-side script on the site. Reads responses through `field()`, which throws on a missing key rather than defaulting. |
| `runtime-history.json` | The upgrade table: the one checked-in record the page is built with. Each applied row carries the sha256 and blake2-256 of the on-chain `:code` at its upgrade block. |

`test/observatory.test.mjs` checks that no reading ships with a value, that
every indexer route and field the script reads exists in `indexer/src`, that
every upgrade row agrees with its `UPGRADE-*.md` record, and that the page
shares this site's palette.

When a runtime upgrade is applied, add its row to `runtime-history.json`,
including the hashes of the on-chain `:code` at the upgrade block (the
"Verify it yourself" section shows the command).

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
