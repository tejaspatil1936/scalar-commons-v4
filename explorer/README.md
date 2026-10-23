# @scalar-commons/explorer

Web block explorer for Scalar Commons. **Block**, **extrinsic** and **account**
pages are server-rendered from a live node, with every page linking to the
next: a block reaches its extrinsics, and an extrinsic reaches the accounts it
touched. The lists — **blocks**, **agent activity**, an account's history —
are read from the indexer, one page at a time.

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

No view walks the chain. The index page costs one header read plus the newest
10 blocks decoded (in parallel); a block or extrinsic page costs the reads it
takes to decode exactly one block plus its readings; an account page costs one
header read and a handful of storage reads (balances, agent metadata and stake,
staking bond, the validator set, the heartbeat); the block list costs two reads
a row for the authors. Nothing here fans a single request out across a range of
blocks, so a visitor cannot turn one HTTP request into an unbounded amount of
node work.

## Lists come from the indexer

Single items — a block, an extrinsic, an account's balances and agent state —
come from the node. Every list — the newest blocks with their counts, the
agent-activity feed, an account's extrinsics and events, the agent record and
the home page's counts — comes from the indexer
(`https://api.scalarnet.io/v1`, routes in [`../indexer/src/api.ts`](../indexer/src/api.ts)),
because a list over history means walking blocks, which is unbounded node work
per page view. Every list is one paged indexer request (`?limit=25&offset=`),
never a scan: the activity feed reads `/v1/activity` with the indexer's own
`?kind=` and `?agent=` filters; one agent's events read
`/v1/agents/:address/events` (or `/v1/events?account=` for an address that is
not a registered agent); an account's extrinsics read
`/v1/accounts/:address/extrinsics`. What the explorer adds is typing: each
event field is typed from the runtime metadata already in memory, so accounts
become links and balances print in tokens because the runtime says they are
balances — and words: `src/words.ts` is the one table from `pallet.Event` and
`pallet.call` to plain sentences, shared by every page.

Each indexer request has a timeout. A list that could not be read renders as a
warning callout with the plain cause; when the list is the page (`/blocks`,
`/activity`) the page is a `502` whose whole message is "The indexer did not
answer in time." — never an internal address, never an empty feed. Pages never
reload themselves.

## The chrome

Pages are drawn in the site's one visual system (SITE-REDESIGN.md §2–§3). The
stylesheet (`src/chrome/`: `tokens.css`, `fonts.css`, `chrome.css` and two
font files) is a synced, byte-identical copy of `landing/src/chrome/` —
`landing/scripts/sync-chrome.mjs` writes it and a landing test fails on drift;
never edit it here. The server serves it at `GET /chrome.css` (the three files
concatenated, read once at startup), the fonts at `GET /fonts/<name>.woff2`
(the stylesheet addresses them as `fonts/…` relative to its own URL), the one
shared behaviour (copy buttons) at `GET /chrome.js` and the favicon at
`GET /favicon.svg`. `src/chrome-templates.ts` mirrors
`landing/src/chrome/templates.mjs` markup for markup, in TypeScript; a test
holds the two equal, component by component. The explorer's own layout rules
(`EXPLORER_CSS` in `src/render.ts`) are a few lines of spacing on the chrome's
scale, checked by the landing's chrome test like any other stylesheet.

Every page names what it read in its footer line ("Read from the node at block
n." / "List from the indexer, read at …"), prints relative times with the
absolute UTC time in the title, and money at two decimals with the full planck
value in the title.

The search field posts to `GET /search?q=` and redirects to the matching view:
a number → block; `0x` + 64 hex → block by hash, else the extrinsic with that
hash among the newest 10 blocks (the node keeps no hash index); `block-index` →
extrinsic; an SS58 address → account; otherwise a "Nothing found" page that
lists the four formats.

## Read-only by construction

The client exposes no signing key and no `tx` surface at all. There is no
request that can change chain or server state.

## Routes

| Path | View |
|---|---|
| `/` | the search field; Block height · Finalized · Registered agents · Last era emission; the latest 10 blocks and the latest 10 agent events; the chain facts |
| `/blocks?offset=` | finalized blocks from the indexer, 25 a page, authors from the node |
| `/block/:number`, `/block/:hash` (`?tab=extrinsics|events`) | block facts, then its extrinsics or its events; previous/next |
| `/extrinsic/:block/:index` | the call in words and raw, result, fee, arguments, events |
| `/account/:address` (`?tab=extrinsics|activity&offset=`) | balances, the agent record when registered, then its history, 25 a page |
| `/activity?agent=&kind=&offset=` | the agent-activity feed, 25 a page, with filter chips and the agent field |
| `/search?q=` | resolves to the matching view (see above) |
| `/chrome.css`, `/chrome.js`, `/favicon.svg`, `/fonts/<name>.woff2` | the synced chrome |

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
| `EXPLORER_INDEXER_URL` | `http://127.0.0.1:8080` | the indexer's origin, read for every list (a trailing `/v1` is tolerated) |

## Tests

```
npm test
```

The live suite talks to the devnet RPC and is **not** skippable: it submits one
real transfer, then asserts the explorer renders that block, that extrinsic and
the accounts it named, cross-checked against direct node reads. An unreachable node
fails the suite — mocking the chain would assert nothing about the only thing
that can really break, which is decoding what a real runtime really returns.
