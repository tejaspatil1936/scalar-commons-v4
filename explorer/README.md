# @scalar-commons/explorer

Web block explorer for Scalar Commons. Three views — **block**, **extrinsic**,
**account** — server-rendered from a live node, with every page linking to the
next: a block reaches its extrinsics, an extrinsic reaches the accounts it
touched, and an account reaches the extrinsics that named it.

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

## Account activity is a bounded scan, and says so

Substrate keeps no account-to-extrinsic index. Activity for an account can only
be found by walking blocks, so the explorer walks a bounded window (default 50
blocks, `EXPLORER_ACCOUNT_SCAN_BLOCKS`) and the page states the exact range it
scanned. It never implies it searched all history.

## Read-only by construction

The client exposes no signing key and no `tx` surface at all, and the server
answers only `GET`/`HEAD` (`405` otherwise). There is no request that can change
chain or server state.

## Routes

| Path | View |
|---|---|
| `/` | chain identity, head, recent blocks, search |
| `/block/:number`, `/block/:hash`, `/block/latest` | block header + its extrinsics |
| `/extrinsic/:block/:index` | call, arguments, events, outcome, accounts touched |
| `/account/:address` | balances, nonce, activity within the scanned window |
| `/search?q=` | `302` to the block or account the query names; `400` if it names neither |

A block is addressed by number or hash; an extrinsic by `(block, index)`, its
only stable on-chain coordinate.

## Run it

```
npm ci
npm run build
npm start                       # http://127.0.0.1:8080
```

| Env | Default | Meaning |
|---|---|---|
| `EXPLORER_RPC_ENDPOINT` | `ws://127.0.0.1:9944` | node to read from |
| `EXPLORER_HOST` / `EXPLORER_PORT` | `127.0.0.1` / `8080` | listen address |
| `EXPLORER_ACCOUNT_SCAN_BLOCKS` | `50` | account activity scan window |

## Tests

```
npm test
```

The live suite talks to the devnet RPC and is **not** skippable: it submits one
real transfer, then asserts the explorer renders that block, that extrinsic and
both accounts, cross-checked against direct node reads. An unreachable node
fails the suite — mocking the chain would assert nothing about the only thing
that can really break, which is decoding what a real runtime really returns.
