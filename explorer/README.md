# @scalar-commons/explorer

Web block explorer for Scalar Commons. Three views — **block**, **extrinsic**,
**account** — server-rendered from a live node, with every page linking to the
next: a block reaches its extrinsics, and an extrinsic reaches the accounts it
touched. The lists — **blocks** and **agent activity** — are read from the
indexer. Every page carries the site's header, footer and search.

## Where the data comes from

The node, at request time. There is no database, no cache and no committed
snapshot: a page is rendered from what the node answered while it was being
rendered, and if the node cannot answer, the page says so (`502`) rather than
serving a plausible-looking empty view.

Every type shape is decoded from the runtime metadata the node serves:

| Shown | Read from |
|---|---|
| Call arguments and their type names | `extrinsic.method.meta.args` |
| Event fields and their names | `event.meta.fields` |
| Dispatch failures (`agents.NotRegistered`, …) | `registry.findMetaError` |
| Token symbol and decimals | the chain's own token properties |
| Accounts an extrinsic touched | the decoded codec tree (see below) |

Nothing about this chain's pallets is hard-coded here, so a runtime upgrade that
adds a pallet or renames a field shows up correctly — or fails loudly — instead
of rendering something stale.

## How "accounts touched" is found

Structurally, never textually. The decoded call arguments and the extrinsic's
events are walked as a codec tree and an account is recognised by *being* an
`AccountId` — which is why `dest: MultiAddress::Id` is found even though it
renders as an object, and why a 32-byte storage hash is not mistaken for a
public key. A string scan would both miss accounts and invent them.

## One page view is a bounded number of node reads

No view walks the chain. A block or extrinsic page costs the reads it takes to
decode exactly one block; an account page costs one header read and a handful
of storage reads (balances, agent metadata and stake, staking bond, the
validator set). Lists — the latest blocks, `/blocks`, an account's activity
and `/activity` — come from the indexer, which already holds that history, so
a visitor cannot turn one HTTP request into an unbounded amount of node work.

## Agent activity

`/activity` is one stream of what agents did: messages, registrations,
heartbeats, the agreement lifecycle, disputes, oracle votes and slashes, newest
first, optionally filtered to one agent (`?agent=<ss58>`; the page has a form).

It does not read the node, because it cannot within the rule above: a feed
over history means walking blocks, which is unbounded node work per page view. The indexer already holds that history and classifies it
(`GET /v1/activity`, see [`../indexer/README.md`](../indexer/README.md)), so the
page costs one indexer request and zero node reads. What the explorer adds is
typing: each event field is typed from the runtime metadata already in memory,
so accounts become links and balances print in tokens because the runtime says
they are balances.

The page does not reload itself: a visitor's scroll position and filter stay
put. Newer rows are one click away ("Previous" goes to the newest page), and
paging (`?page=`) reaches every event the indexer holds. Rows carry relative
times ("4 min ago") with the UTC time in `title`.

If the indexer is down or answers with something that is not the feed, the page
is a `502` with one plain sentence — never an empty feed, and never an internal
address. The runtime has no
`messages` pallet from runtime 309, so `message` rows appear once agents start
sending.

## The chrome

Pages use the site's plain chrome (SITE-REDESIGN.md §3): the same header,
footer, tokens, type and components as scalarnet.io and the docs. The
stylesheet (`src/chrome/`: `tokens.css`, `fonts.css`, `chrome.css` and two
font files, Inter and JetBrains Mono) is a synced, byte-identical copy of
`landing/src/chrome/` — `landing/scripts/sync-chrome.mjs` writes it and a
landing test fails on drift; never edit it here. The server serves it at
`GET /chrome.css` (the three files plus the explorer's few page-scoped rules
in `src/explorer-css.ts`, read once at startup, gzipped when the request
accepts it) and the fonts at `GET /fonts/<name>.woff2`.
`src/chrome-templates.ts` mirrors `landing/src/chrome/templates.mjs` markup
for markup, in TypeScript.

Every page is server-rendered. Every upstream read is bounded
(`EXPLORER_READ_TIMEOUT_MS`); a read that fails costs one figure, which keeps
its last value and is marked Stale, not the page. The only script shipped is
the chrome's copy button.

The search field (on every page) goes to `GET /search?q=` and redirects to the
matching view: a block number → block; `0x` + 64 hex → block by hash; a
`block-index` pair → that extrinsic; an SS58 address → account; otherwise a
"Nothing found" page with the query and a way back.

## Read-only by construction

The client exposes no signing key and no `tx` surface at all. There is no
request that can change chain or server state.

## Routes

| Path | View |
|---|---|
| `/` | search; the network's figures; the latest blocks and the latest agent activity |
| `/blocks`, `/blocks?page=` | every block, newest first, paged |
| `/search?q=` | resolves to the matching view (see above) |
| `/chrome.css`, `/fonts/<name>.woff2`, `/favicon.svg` | the synced chrome |
| `/block/:number`, `/block/:hash` (`?tab=events`) | header, author, finalized state, extrinsics or events, previous/next |
| `/extrinsic/:block/:index` | call, arguments, events, outcome, accounts touched |
| `/account/:address` (`?tab=activity`, `?page=`) | balances in CMN, agent details when registered, its extrinsics or its activity |
| `/activity`, `?agent=:address`, `?kind=`, `?page=` | agent-activity feed from the indexer, newest first |

A block is addressed by number or hash; an extrinsic by `(block, index)`, its
only stable on-chain coordinate.

## Run it

```
npm ci
npm run build
npm start                       # http://127.0.0.1:8081
```

| Env | Default | Meaning |
|---|---|---|
| `EXPLORER_RPC_ENDPOINT` | `ws://127.0.0.1:9944` | node to read from |
| `EXPLORER_HOST` / `EXPLORER_PORT` | `127.0.0.1` / `8081` | listen address (8081, not 8080: the indexer owns 8080) |
| `EXPLORER_INDEXER_URL` | `http://127.0.0.1:8080` | indexer the lists (blocks, activity, agents) are read from |
| `EXPLORER_READ_TIMEOUT_MS` | `1500` | how long one upstream read may take before the figure goes Stale |

## Tests

```
npm test
```

The unit suites render every view from fixtures. The live suite
(`tests/explorer.live.test.ts`) talks to a **local devnet** RPC and is not
skippable: it submits one real transfer, then asserts the explorer renders
that block, that extrinsic and the accounts it named, cross-checked against
direct node reads. Never point it at the public testnet — it signs and
submits a real transaction. Without a local node, run the unit suites only:
`npx vitest run --exclude tests/explorer.live.test.ts`.
