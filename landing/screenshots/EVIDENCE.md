# Evidence for the plain redesign (SITE-REDESIGN.md §10.8)

Measured on 23 Oct 2026 against this branch, built locally and served the way nginx serves it
(`try_files $uri $uri/ $uri.html`, unknown paths → `404.html`), with the explorer running against the
public node (`wss://rpc.scalarnet.io`) and the public indexer (`https://api.scalarnet.io/v1`), in
Chromium at 1440×900 and 390×844 with live data. The screenshots beside this file
(`plain-<page>-<width>.png`) are full-page captures from the same run.

## Gates

- `cd landing && npm test` — 128 tests, 128 pass, 0 fail
- `cd explorer && npx vitest run --exclude tests/explorer.live.test.ts` — 9 files, 114 tests passed (the live test is not run: it signs a real transaction on the public testnet)
- `cd docs && node scripts/check-chain-values.mjs` — docs match the runtime snapshot (scalar-commons spec 309 @ #1157827); `DOCS_BASE=/docs/ npm run build` — complete
- `node landing/scripts/check-layout.mjs --wait 15000` (every page, both widths, live data):

```
ok   404@1440 /no-page-is-logged-here — 0 stats, 0 tables, scrollWidth 1440
ok   404@390 /no-page-is-logged-here — 0 stats, 0 tables, scrollWidth 390
ok   home@1440 /index.html — 4 stats, 2 tables, scrollWidth 1440
ok   home@390 /index.html — 4 stats, 2 tables, scrollWidth 390
ok   network@1440 /network.html — 16 stats, 7 tables, scrollWidth 1440
ok   network@390 /network.html — 16 stats, 7 tables, scrollWidth 390
ok   faucet@1440 /faucet.html — 0 stats, 0 tables, scrollWidth 1440
ok   faucet@390 /faucet.html — 0 stats, 0 tables, scrollWidth 390
ok   oversight@1440 /oversight.html — 5 stats, 8 tables, scrollWidth 1440
ok   oversight@390 /oversight.html — 5 stats, 8 tables, scrollWidth 390
ok   docs-home@1440 /docs/ — 0 stats, 0 tables, scrollWidth 1440
ok   docs-home@390 /docs/ — 0 stats, 0 tables, scrollWidth 390
ok   docs-article@1440 /docs/guide/run-a-node.html — 0 stats, 0 tables, scrollWidth 1440
ok   docs-article@390 /docs/guide/run-a-node.html — 0 stats, 0 tables, scrollWidth 390
ok   docs-404@1440 /docs/no-page-is-logged-here — 0 stats, 0 tables, scrollWidth 1440
ok   docs-404@390 /docs/no-page-is-logged-here — 0 stats, 0 tables, scrollWidth 390
ok   explorer-home@1440 explorer:/ — 4 stats, 3 tables, scrollWidth 1440
ok   explorer-home@390 explorer:/ — 4 stats, 3 tables, scrollWidth 390
ok   explorer-blocks@1440 explorer:/blocks — 0 stats, 1 tables, scrollWidth 1440
ok   explorer-blocks@390 explorer:/blocks — 0 stats, 1 tables, scrollWidth 390
ok   explorer-block@1440 explorer:/block/1167917 — 0 stats, 2 tables, scrollWidth 1440
ok   explorer-block@390 explorer:/block/1167917 — 0 stats, 2 tables, scrollWidth 390
ok   explorer-extrinsic@1440 explorer:/extrinsic/1167917/0 — 0 stats, 3 tables, scrollWidth 1440
ok   explorer-extrinsic@390 explorer:/extrinsic/1167917/0 — 0 stats, 3 tables, scrollWidth 390
ok   explorer-account@1440 explorer:/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe — 0 stats, 2 tables, scrollWidth 1440
ok   explorer-account@390 explorer:/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe — 0 stats, 2 tables, scrollWidth 390
ok   explorer-activity@1440 explorer:/activity — 0 stats, 1 tables, scrollWidth 1440
ok   explorer-activity@390 explorer:/activity — 0 stats, 1 tables, scrollWidth 390
ok   explorer-search@1440 explorer:/search?q=nothing-matches-this — 0 stats, 0 tables, scrollWidth 1440
ok   explorer-search@390 explorer:/search?q=nothing-matches-this — 0 stats, 0 tables, scrollWidth 390

check-layout: clean
```

Notes on the click outcomes below: `NAV` and `NAV_EXTERNAL` are navigations (external = off the local
origins, i.e. to scalarnet.io, explorer.scalarnet.io, GitHub); `TOGGLE` opens or closes a disclosure or
tab; `DOM_CHANGE` changes the page in place (filters, the faucet form); `ANCHOR` jumps within the page.
`ERROR:click-timeout` is the skip link (1×1 px until focused); `ERROR:not-found-on-reload` is a live row
whose text changed between page loads (block numbers, relative times), so the crawler could not find the
same control again; `NOTHING` is a download link, a copy button (clipboard, not observable), the already
selected tab, or a VitePress code block or table (focusable, not a control).

### Pages (live data, 1440 and 390 px)

| page | status | words (all / outside tables) | height 1440 / 390 | first load | fonts | uppercase | axe | h1 | favicon · description · canonical · og | overflow |
|---|---|---|---|---|---|---|---|---|---|---|
| home | 200 | 659 / 351 | 4539 / 6616 | 109 KB, 11 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| network | 200 | 1070 / 196 | 7749 / 9644 | 169 KB, 20 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| faucet | 200 | 127 / 76 | 1053 / 1694 | 104 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| oversight | 200 | 861 / 490 | 5007 / 6690 | 389 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| 404 | 404 | 83 / 13 | 900 / 1450 | 91 KB, 3 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| observatory-redirect | 200 | 1070 / 196 | 7749 / 9644 | 169 KB, 18 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| docs-home | 200 | 210 / 165 | 1138 / 1723 | 347 KB, 8 req | Inter Variable | 0 | 2 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| docs-article | 200 | 2414 / 2061 | 10048 / 13878 | 397 KB, 9 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| docs-validator | 200 | 3262 / 2486 | 13565 / 18827 | 414 KB, 9 req | Inter Variable, JetBrains Mono | 0 | 2 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| docs-404 | 404 | 48 / 14 | 900 / 844 | 338 KB, 8 req | Inter Variable | 0 | 5 | 1 | ✓ · ✓ · ✗ · ✓ | no |
| explorer-home | 200 | 299 / 24 | 1995 / 3616 | 122 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-blocks | 200 | 386 / 10 | 2317 / 2976 | 145 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-activity | 200 | 317 / 17 | 2429 / 3477 | 125 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-search-miss | 404 | 116 / 39 | 1064 / 1784 | 102 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-block | 200 | 136 / 10 | 1569 / 2363 | 104 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-extrinsic | 200 | 130 / 11 | 1593 / 2276 | 103 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 0 | 1 | ✓ · ✓ · ✓ · ✓ | no |
| explorer-account | 200 | 324 / 8 | 3001 / 4194 | 111 KB, 5 req | Inter Variable, JetBrains Mono | 0 | 1 | 1 | ✓ · ✓ · ✓ · ✓ | no |

### Every control clicked at 1440 (chrome controls once, on the home and explorer home; page controls on every page)

| page | controls | outcome |
|---|---|---|
| home | 26 | DOM_CHANGE 3, ERROR 1, NAV 18, NAV_EXTERNAL 4 |
| network | 58 | DOM_CHANGE 3, ERROR 15, NAV_EXTERNAL 34, NOTHING 1, TOGGLE 5 |
| faucet | 5 | DOM_CHANGE 1, ERROR 3, TOGGLE 1 |
| oversight | 48 | ERROR 41, NOTHING 1, TOGGLE 6 |
| 404 | 4 | ERROR 1, NAV 3 |
| docs-home | 11 | ERROR 1, NAV 8, NAV_EXTERNAL 2 |
| docs-article | 24 | ANCHOR 1, ERROR 1, NAV 3, NAV_EXTERNAL 2, NOTHING 17 |
| docs-validator | 44 | ANCHOR 2, ERROR 1, NAV_EXTERNAL 6, NOTHING 35 |
| docs-404 | 2 | ERROR 1, NAV 1 |
| explorer-home | 42 | ERROR 12, NAV 12, NAV_EXTERNAL 17, NOTHING 1 |
| explorer-blocks | 59 | ERROR 51, NAV 8 |
| explorer-activity | 37 | DOM_CHANGE 1, ERROR 1, NAV 35 |
| explorer-search-miss | 2 | DOM_CHANGE 1, ERROR 1 |
| explorer-block | 9 | ERROR 1, NAV 6, NOTHING 2 |
| explorer-extrinsic | 3 | ERROR 1, NAV 1, NOTHING 1 |
| explorer-account | 56 | ERROR 1, NAV 53, NOTHING 1, SCROLL 1 |

Total: 430 controls — {'ANCHOR': 3, 'DOM_CHANGE': 9, 'ERROR': 133, 'NAV': 148, 'NAV_EXTERNAL': 65, 'NOTHING': 59, 'SCROLL': 1, 'TOGGLE': 12}.

Controls with no observable effect or an error (each explained):

| page | control | outcome |
|---|---|---|
| home | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| network | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| network | `a` “1,167,356” → https://explorer.scalarnet.io/block/1167356 | ERROR:not-found-on-reload |
| network | `a` “1,167,348” → https://explorer.scalarnet.io/block/1167348 | ERROR:not-found-on-reload |
| network | `a` “1,167,355” → https://explorer.scalarnet.io/block/1167355 | ERROR:not-found-on-reload |
| network | `a` “1,167,352” → https://explorer.scalarnet.io/block/1167352 | ERROR:not-found-on-reload |
| network | `a` “1,167,345” → https://explorer.scalarnet.io/block/1167345 | ERROR:not-found-on-reload |
| network | `a` “1,167,354” → https://explorer.scalarnet.io/block/1167354 | ERROR:not-found-on-reload |
| network | `a` “1,167,357” → https://explorer.scalarnet.io/block/1167357 | ERROR:not-found-on-reload |
| network | `a` “1,167,342” → https://explorer.scalarnet.io/block/1167342 | ERROR:not-found-on-reload |
| network | `a` “1,167,353” → https://explorer.scalarnet.io/block/1167353 | ERROR:not-found-on-reload |
| network | `a` “1,167,351” → https://explorer.scalarnet.io/block/1167351 | ERROR:not-found-on-reload |
| network | `a` “1,167,350” → https://explorer.scalarnet.io/block/1167350 | ERROR:not-found-on-reload |
| network | `a` “1,167,349” → https://explorer.scalarnet.io/block/1167349 | ERROR:not-found-on-reload |
| network | `a` “1,167,347” → https://explorer.scalarnet.io/block/1167347 | ERROR:not-found-on-reload |
| network | `a` “1,167,346” → https://explorer.scalarnet.io/block/1167346 | ERROR:not-found-on-reload |
| network | `a` “status.json (download)” → status.json | NOTHING |
| faucet | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| faucet | `button` “Copy code curl -s https://faucet.scalarn”  | ERROR:not-found-on-reload |
| faucet | `button` “Copy code curl -s -X POST https://faucet”  | ERROR:not-found-on-reload |
| oversight | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| oversight | `a` “oversight-sample.json (download)” → /oversight-sample.json | NOTHING |
| oversight | `a` “” → #msg-704003-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704004-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704005-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704006-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704007-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704008-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704009-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704010-8 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704011-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704012-5 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704013-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704014-36 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704015-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704016-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704017-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704018-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704019-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704020-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704021-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704022-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704023-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704024-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704025-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704026-8 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704027-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704028-40 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704029-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704030-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704031-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704032-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704033-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704034-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704035-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704036-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704037-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704038-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704039-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704040-8 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704041-4 | ERROR:not-found-on-reload |
| oversight | `a` “” → #msg-704042-40 | ERROR:not-found-on-reload |
| 404 | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| docs-home | `a` “Skip to content” → #VPContent | ERROR:click-timeout(obscured or not interactable) |
| docs-article | `a` “Skip to content” → #VPContent | ERROR:click-timeout(obscured or not interactable) |
| docs-article | `pre` “[toolchain] channel = "1.85.0" component”  | NOTHING |
| docs-article | `pre` “rustup show # confirm 1.85.0 and wasm32v”  | NOTHING |
| docs-article | `pre` “./target/release/scalar-node --version”  | NOTHING |
| docs-article | `table` “--chain Spec id Name Chain type Authorit”  | NOTHING |
| docs-article | `table` “Property Value Note tokenSymbol CMN toke”  | NOTHING |
| docs-article | `table` “Recipient Allocation Share of mint Found”  | NOTHING |
| docs-article | `pre` “./deploy/build-spec.sh # writes deploy/s”  | NOTHING |
| docs-article | `pre` “/ip4/127.0.0.1/tcp/30333/p2p/12D3KooWEyo”  | NOTHING |
| docs-article | `pre` “./target/release/scalar-node \ --chain d”  | NOTHING |
| docs-article | `pre` “curl -sH 'Content-Type: application/json”  | NOTHING |
| docs-article | `pre` “{"jsonrpc":"2.0","id":1,"result":{"peers”  | NOTHING |
| docs-article | `pre` “./deploy/finality-check.sh 12 5 # 12 sam”  | NOTHING |
| docs-article | `table` “Node p2p RPC Prometheus Pruning alice 30”  | NOTHING |
| docs-article | `pre` “ssh -L 9944:127.0.0.1:9944 user@your-hos”  | NOTHING |
| docs-article | `pre` “./target/release/scalar-node key generat”  | NOTHING |
| docs-article | `pre` “{"jsonrpc":"2.0","id":1,"error":{"code":”  | NOTHING |
| docs-article | `table` “n Threshold Tolerated down 3 3 0 4 3 1 5”  | NOTHING |
| docs-validator | `a` “Skip to content” → #VPContent | ERROR:click-timeout(obscured or not interactable) |
| docs-validator | `table` “Value Where staking.validatorCount 8 val”  | NOTHING |
| docs-validator | `table` “Measured Recommendation CPU alice: 1.7 %”  | NOTHING |
| docs-validator | `table` “Port Bind Reachable from Why p2p (30333 ”  | NOTHING |
| docs-validator | `pre` “mkdir -p ~/scalar && cd ~/scalar curl -s”  | NOTHING |
| docs-validator | `pre` “7f6efa029e3f94f8f100f2d9f9797d865789e532”  | NOTHING |
| docs-validator | `pre` “sudo apt-get install -y build-essential ”  | NOTHING |
| docs-validator | `pre` “real 16m33.213s (-j 8 on an AMD EPYC 964”  | NOTHING |
| docs-validator | `pre` “mkdir -p ~/scalar && cd ~/scalar curl -s”  | NOTHING |
| docs-validator | `pre` “http=200 ct=application/json bytes=23565”  | NOTHING |
| docs-validator | `pre` “/ip4/152.53.113.104/tcp/30333/p2p/12D3Ko”  | NOTHING |
| docs-validator | `pre` “Error: NetworkKeyNotFound("/home/dev/out”  | NOTHING |
| docs-validator | `pre` “./scalar-node key generate-node-key --ch”  | NOTHING |
| docs-validator | `pre` “Generating key in "/home/dev/outsider-va”  | NOTHING |
| docs-validator | `pre` “install -D -m 644 deploy/validator/scala”  | NOTHING |
| docs-validator | `pre` “NODE_BIN=/home/dev/outsider-validator.SQ”  | NOTHING |
| docs-validator | `pre` “scalar-node --chain chainspec.json --bas”  | NOTHING |
| docs-validator | `pre` “🏷 Node name: outsider-guide-test 👤 Role:”  | NOTHING |
| docs-validator | `pre` “0.0.0.0:30338 [::]:30338 scalar-node <- ”  | NOTHING |
| docs-validator | `pre` “curl -s -H 'content-type: application/js”  | NOTHING |
| docs-validator | `pre` “{"jsonrpc":"2.0","id":1,"error":{"code":”  | NOTHING |
| docs-validator | `pre` “sed -i 's/^RPC_METHODS=safe$/RPC_METHODS”  | NOTHING |
| docs-validator | `pre` “{"jsonrpc":"2.0","id":1,"result":"0x6a4f”  | NOTHING |
| docs-validator | `pre` “// stash.mjs (npm install @polkadot/api@”  | NOTHING |
| docs-validator | `pre` “curl -s -X POST https://faucet.scalarnet”  | NOTHING |
| docs-validator | `pre` “{"ok":true,"address":"5FADXQgabx5SaZg43Y”  | NOTHING |
| docs-validator | `pre` “// stake.mjs (excerpt) — the full script”  | NOTHING |
| docs-validator | `pre` “{"label":"staking.bond","txHash":"0x33cc”  | NOTHING |
| docs-validator | `pre` “{"label":"staking.validate","txHash":"0x”  | NOTHING |
| docs-validator | `pre` “{"stash":"5FADXQgabx5SaZg43YwZs3Q3XMfMUE”  | NOTHING |
| docs-validator | `pre` “{"at":"2026-09-25T20:20:23Z","result":"E”  | NOTHING |
| docs-validator | `pre` “766726 0xcfee085a…a6da author 5FADXQgabx”  | NOTHING |
| docs-validator | `pre` “🎁 Prepared block for proposing at 766726”  | NOTHING |
| docs-validator | `pre` “journalctl --user -u scalar-validator -f”  | NOTHING |
| docs-validator | `pre` “await api.tx.staking.chill().signAndSend”  | NOTHING |
| docs-validator | `table` “# Finding Where 1 Validators are unpaid.”  | NOTHING |
| docs-404 | `a` “Skip to content” → #VPContent | ERROR:click-timeout(obscured or not interactable) |
| explorer-home | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-home | `a` “1,167,389” → /block/1167389 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,388” → /block/1167388 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,387” → /block/1167387 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,386” → /block/1167386 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,385” → /block/1167385 | ERROR:not-found-on-reload |
| explorer-home | `a` “5HKPmK…4ns8” → /account/5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,384” → /block/1167384 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,383” → /block/1167383 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,382” → /block/1167382 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,381” → /block/1167381 | ERROR:not-found-on-reload |
| explorer-home | `a` “1,167,380” → /block/1167380 | ERROR:not-found-on-reload |
| explorer-home | `button` “Copy”  | NOTHING |
| explorer-blocks | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-blocks | `a` “1,167,392” → /block/1167392 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x4d67b0…c83ff1” → /block/0x4d67b00d730581d3f6aaf817cb731961c93297c70c270499619edc7cc5c83ff1 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,391” → /block/1167391 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x64b22c…d7416f” → /block/0x64b22c7fecb57821b6183bb16562f1de9cbc64e1b7fb22e15f30116054d7416f | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,390” → /block/1167390 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x5b3ec4…19cb87” → /block/0x5b3ec48f6a6a637154d5c495e3cc25fc2987982f18f61eab44beaaed8b19cb87 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,389” → /block/1167389 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x7024fd…3c770b” → /block/0x7024fda911f90664d7340247449495104b6caf9e0fd23276a1def782f33c770b | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,388” → /block/1167388 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x9b872d…feef63” → /block/0x9b872d01f1220cf7b866de81347fbdbb7e678293b858ff53c0e8c3dc5dfeef63 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,387” → /block/1167387 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x4cad31…d5f287” → /block/0x4cad319a853055a5ed055e5fb07ed519f36e6737a9377fa2e4941cefb7d5f287 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,386” → /block/1167386 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x68d73a…ccb677” → /block/0x68d73a7d44bf31a866414445a94e163175e8358eb7a43febe1d41f3187ccb677 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,385” → /block/1167385 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x2de9d2…023b6b” → /block/0x2de9d28fced887064392bc1de2ee489057503f03451c47139a457226d7023b6b | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,384” → /block/1167384 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xf368e7…49910e” → /block/0xf368e715a4e6d43a878fc58021baca85ea68c0e0a1ba04c766fb779ea849910e | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,383” → /block/1167383 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x3e2a35…e5c31e” → /block/0x3e2a35aeda16c716dac9be759f666d2a75eb1d6235b2f58791f2b1e431e5c31e | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,382” → /block/1167382 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xba5f74…a13067” → /block/0xba5f74aa42bb8ce307944323ed683cc8b9d213d5d290a4bcbdf27b77bea13067 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,381” → /block/1167381 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x344ff8…3cc553” → /block/0x344ff8a542a1f2534cddeaace65c23051257558efea3c3b38bd41948803cc553 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,380” → /block/1167380 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x6b57be…9cbad7” → /block/0x6b57be736b1e6f9770bbde6a7490f6d026c1eeac86730719aafd62c02c9cbad7 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,379” → /block/1167379 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x15892d…e424db” → /block/0x15892d3efc75ca427ffa25babdee53bc29bd821f3eb07971827c923501e424db | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,378” → /block/1167378 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x006259…be685d” → /block/0x0062591fc91d1a0bb5a90ae7cb30ee09e5d65177fa447ed7cc184f6517be685d | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,377” → /block/1167377 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xf1d5dc…35084d” → /block/0xf1d5dca000ea6971a2935c518f9b468fcc57a6d078c9910b0c225d11fd35084d | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,376” → /block/1167376 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x92b473…4e257c” → /block/0x92b473499035363b32df09c56966caabbfc1f1d83f504ab2bf8d6a15ab4e257c | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,375” → /block/1167375 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xfb17f9…cb40f7” → /block/0xfb17f9bc00754416f1dcf496ec4f86b5a641e0186548697bab8ca50c06cb40f7 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,374” → /block/1167374 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x65c797…35b2f9” → /block/0x65c797be21547b31c9d0f2762b1692c52287dca595ded21a79d3367bd435b2f9 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,373” → /block/1167373 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xbc14ea…e7847f” → /block/0xbc14ead1cb2f04035c0f01ee135abd0f5707a673c498006028db2c11f3e7847f | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,372” → /block/1167372 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x6fde16…79b114” → /block/0x6fde16a4ed4b4adf4fd2ea05728a66fb56a2f27458bb7e4523e749133479b114 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,371” → /block/1167371 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xc00237…9d6123” → /block/0xc00237d802f5b7f0502874255e47b6d657536daf8a3bbaab360a117f169d6123 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,370” → /block/1167370 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0xf1627a…88d323” → /block/0xf1627aa2a4c5a44ec04ea48b74c8dd78833b795d1ea99705df9165f60688d323 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,369” → /block/1167369 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x65ea0b…f921c1” → /block/0x65ea0b00ec766f793ddc442ee4dfa5a549c6fd4ef192e67cc1fa310c0ef921c1 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “1,167,368” → /block/1167368 | ERROR:not-found-on-reload |
| explorer-blocks | `a` “0x7af524…12e2a0” → /block/0x7af5243a499654e6b782c38453db4a527f5f37fb6fe00f84552ab97f0b12e2a0 | ERROR:not-found-on-reload |
| explorer-activity | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-search-miss | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-block | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-block | `button` “Copy”  | NOTHING |
| explorer-block | `a` “Extrinsics (1)” → /block/1167348 | NOTHING |
| explorer-extrinsic | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-extrinsic | `button` “Copy”  | NOTHING |
| explorer-account | `a` “Skip to content” → #main | ERROR:click-timeout(obscured or not interactable) |
| explorer-account | `button` “Copy”  | NOTHING |

### Where every link goes

693 distinct visible links across the pages at 1440 px; every `href` was requested and the status recorded below.

| page | link text | href |
|---|---|---|
| home | Skip to content | `#main` |
| home | Scalar Commons | `/` |
| home | Network | `/network` |
| home | Explorer | `https://explorer.scalarnet.io/` |
| home | Docs | `/docs/` |
| home | Faucet | `/faucet` |
| home | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| home | Get started | `/docs/guide/run-an-agent` |
| home | View the network | `/network` |
| home | See the network | `/network` |
| home | Read the reference | `/docs/reference/rpc` |
| home | Read the token model | `/docs/reference/token-model` |
| home | See the live figures | `/network` |
| home | Read the guide | `/docs/guide/run-an-agent` |
| home | Read the guide | `/docs/guide/run-a-validator` |
| home | Read the guide | `/docs/guide/sdk` |
| home | Home | `/` |
| home | Run a node | `/docs/guide/run-a-node` |
| home | Run an agent | `/docs/guide/run-an-agent` |
| home | Run a validator | `/docs/guide/run-a-validator` |
| home | SDK | `/docs/guide/sdk` |
| home | Privacy demo | `/oversight` |
| home | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| home | Constitution | `/docs/reference/constitution` |
| home | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| home | Chain spec (download) | `/docs/chainspec.json` |
| network | Skip to content | `#main` |
| network | Scalar Commons | `/` |
| network | Network | `/network` |
| network | Explorer | `https://explorer.scalarnet.io/` |
| network | Docs | `/docs/` |
| network | Faucet | `/faucet` |
| network | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| network | Get started | `/docs/guide/run-an-agent` |
| network | 5Ck5SL…EAPT | `https://explorer.scalarnet.io/account/5Ck5SLSHYac6WFt5UZRSsdJjwmpSZq85fd5TRNAdZQVzEAPT` |
| network | 1,167,830 | `https://explorer.scalarnet.io/block/1167830` |
| network | 5EXafH…5r5Y | `https://explorer.scalarnet.io/account/5EXafHTU8EqCiszgQh6TVx7sZE7v3VQmvCyNVmsmrDzP5r5Y` |
| network | 1,167,833 | `https://explorer.scalarnet.io/block/1167833` |
| network | 5FCfAo…FE7n | `https://explorer.scalarnet.io/account/5FCfAonRZgTFrTd9HREEyeJjDpT397KMzizE6T3DvebLFE7n` |
| network | 1,167,822 | `https://explorer.scalarnet.io/block/1167822` |
| network | 5GNJqT…xiZY | `https://explorer.scalarnet.io/account/5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY` |
| network | 1,167,824 | `https://explorer.scalarnet.io/block/1167824` |
| network | 5HKPmK…4ns8 | `https://explorer.scalarnet.io/account/5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8` |
| network | 1,167,834 | `https://explorer.scalarnet.io/block/1167834` |
| network | 5HjKj1…tbYe | `https://explorer.scalarnet.io/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe` |
| network | 1,167,825 | `https://explorer.scalarnet.io/block/1167825` |
| network | 5Honeo…oJfc | `https://explorer.scalarnet.io/account/5HoneoB6L3ctEoJVxGTHMNBVVakCW8YPyedCzsXp4fM2oJfc` |
| network | 1,167,828 | `https://explorer.scalarnet.io/block/1167828` |
| network | 5HpG9w…SWFc | `https://explorer.scalarnet.io/account/5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc` |
| network | 1,167,827 | `https://explorer.scalarnet.io/block/1167827` |
| network | 1,167,832 | `https://explorer.scalarnet.io/block/1167832` |
| network | 1,167,831 | `https://explorer.scalarnet.io/block/1167831` |
| network | 1,167,829 | `https://explorer.scalarnet.io/block/1167829` |
| network | 1,167,826 | `https://explorer.scalarnet.io/block/1167826` |
| network | 1,167,823 | `https://explorer.scalarnet.io/block/1167823` |
| network | Open in explorer | `https://explorer.scalarnet.io/blocks` |
| network | 5DejGJ…yxsE | `https://explorer.scalarnet.io/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| network | 5FxmBm…duiA | `https://explorer.scalarnet.io/account/5FxmBmmd4ujrU5tvxq8ATq3nCbA2Gw8yfMiko7dKRT8GduiA` |
| network | All activity in the explorer | `https://explorer.scalarnet.io/activity` |
| network | 5CexT5…nGB5 | `https://explorer.scalarnet.io/account/5CexT5Tyu6e9c5agRxwfMuQu73hK9n9oxW9kuYhKdRqBnGB5` |
| network | 953,276 | `https://explorer.scalarnet.io/block/953276` |
| network | 5GLCeN…VqGw | `https://explorer.scalarnet.io/account/5GLCeNQyUH9BEftJ3sdXDS4rYxMTSqp2JbdWxnZZXQNnVqGw` |
| network | 947,769 | `https://explorer.scalarnet.io/block/947769` |
| network | 5EoLFT…MRtZ | `https://explorer.scalarnet.io/account/5EoLFT2EPqX43R9Bs7J76ChoFUfbBLUyLQPhq3LSrSKHMRtZ` |
| network | 934,777 | `https://explorer.scalarnet.io/block/934777` |
| network | 5DSTm7…Y4FZ | `https://explorer.scalarnet.io/account/5DSTm7o2cYoadTdpwnmqNiCv9Sf8CQUBUNPRpMZixMhSY4FZ` |
| network | 934,775 | `https://explorer.scalarnet.io/block/934775` |
| network | 5CrYaQ…zk61 | `https://explorer.scalarnet.io/account/5CrYaQEsGuhy4kPfneSbEdpB9FgT5GQetDL5NqBaacZzzk61` |
| network | 932,805 | `https://explorer.scalarnet.io/block/932805` |
| network | 5EcdFx…zPwa | `https://explorer.scalarnet.io/account/5EcdFxGPd4eFbDeq2RLNZFwBk3d8u55486vngPYKwqm9zPwa` |
| network | 932,802 | `https://explorer.scalarnet.io/block/932802` |
| network | 5F1Y7s…Dbcs | `https://explorer.scalarnet.io/account/5F1Y7sJbN9ezqSets2PzLaxdq1nmGmLuFs5qm2Hq6fkQDbcs` |
| network | 932,087 | `https://explorer.scalarnet.io/block/932087` |
| network | 5HYuhs…YPtr | `https://explorer.scalarnet.io/account/5HYuhsU99rkof2VF6S7RznV3hnXTvqAQVoTetu3SaKFrYPtr` |
| network | 932,084 | `https://explorer.scalarnet.io/block/932084` |
| network | 5GEb1a…2YcC | `https://explorer.scalarnet.io/account/5GEb1aEz8xAXpNJ3KcUFT4JefoGkybeqxkuBoitv65KX2YcC` |
| network | 932,081 | `https://explorer.scalarnet.io/block/932081` |
| network | 5H19Vs…rsRV | `https://explorer.scalarnet.io/account/5H19VsfjJtAEMDG7PAF1WP6wCGus8nPn8dNXwQwCXPW5rsRV` |
| network | 932,078 | `https://explorer.scalarnet.io/block/932078` |
| network | 907,929 | `https://explorer.scalarnet.io/block/907929` |
| network | 813,625 | `https://explorer.scalarnet.io/block/813625` |
| network | 543,472 | `https://explorer.scalarnet.io/block/543472` |
| network | 527,277 | `https://explorer.scalarnet.io/block/527277` |
| network | runtime-history.json (download) | `runtime-history.json` |
| network | status.json (download) | `status.json` |
| network | posture.json (download) | `posture.json` |
| network | Home | `/` |
| network | Run a node | `/docs/guide/run-a-node` |
| network | Run an agent | `/docs/guide/run-an-agent` |
| network | Run a validator | `/docs/guide/run-a-validator` |
| network | SDK | `/docs/guide/sdk` |
| network | Privacy demo | `/oversight` |
| network | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| network | Constitution | `/docs/reference/constitution` |
| network | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| network | Chain spec (download) | `/docs/chainspec.json` |
| faucet | Skip to content | `#main` |
| faucet | Scalar Commons | `/` |
| faucet | Network | `/network` |
| faucet | Explorer | `https://explorer.scalarnet.io/` |
| faucet | Docs | `/docs/` |
| faucet | Faucet | `/faucet` |
| faucet | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| faucet | Get started | `/docs/guide/run-an-agent` |
| faucet | Home | `/` |
| faucet | Run a node | `/docs/guide/run-a-node` |
| faucet | Run an agent | `/docs/guide/run-an-agent` |
| faucet | Run a validator | `/docs/guide/run-a-validator` |
| faucet | SDK | `/docs/guide/sdk` |
| faucet | Privacy demo | `/oversight` |
| faucet | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| faucet | Constitution | `/docs/reference/constitution` |
| faucet | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| faucet | Chain spec (download) | `/docs/chainspec.json` |
| oversight | Skip to content | `#main` |
| oversight | Scalar Commons | `/` |
| oversight | Network | `/network` |
| oversight | Explorer | `https://explorer.scalarnet.io/` |
| oversight | Docs | `/docs/` |
| oversight | Faucet | `/faucet` |
| oversight | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| oversight | Get started | `/docs/guide/run-an-agent` |
| oversight | oversight-sample.json (download) | `/oversight-sample.json` |
| oversight | One negotiation, end to end | `#g-thread` |
| oversight | Decrypted by the operator | `#g-decrypted` |
| oversight | Public on chain | `#g-plain` |
| oversight | Sealed, no key held | `#g-sealed` |
| oversight | Hash-only | `#g-hash-only` |
| oversight | All messages, in block order | `#g-all` |
| oversight | (icon) | `#msg-704003-4` |
| oversight | (icon) | `#msg-704004-4` |
| oversight | (icon) | `#msg-704005-4` |
| oversight | (icon) | `#msg-704006-4` |
| oversight | (icon) | `#msg-704007-4` |
| oversight | (icon) | `#msg-704008-4` |
| oversight | (icon) | `#msg-704009-4` |
| oversight | (icon) | `#msg-704010-8` |
| oversight | (icon) | `#msg-704011-4` |
| oversight | (icon) | `#msg-704012-5` |
| oversight | (icon) | `#msg-704013-4` |
| oversight | (icon) | `#msg-704014-36` |
| oversight | (icon) | `#msg-704015-4` |
| oversight | (icon) | `#msg-704016-4` |
| oversight | (icon) | `#msg-704017-4` |
| oversight | (icon) | `#msg-704018-4` |
| oversight | (icon) | `#msg-704019-4` |
| oversight | (icon) | `#msg-704020-4` |
| oversight | (icon) | `#msg-704021-4` |
| oversight | (icon) | `#msg-704022-4` |
| oversight | (icon) | `#msg-704023-4` |
| oversight | (icon) | `#msg-704024-4` |
| oversight | (icon) | `#msg-704025-4` |
| oversight | (icon) | `#msg-704026-8` |
| oversight | (icon) | `#msg-704027-4` |
| oversight | (icon) | `#msg-704028-40` |
| oversight | (icon) | `#msg-704029-4` |
| oversight | (icon) | `#msg-704030-4` |
| oversight | (icon) | `#msg-704031-4` |
| oversight | (icon) | `#msg-704032-4` |
| oversight | (icon) | `#msg-704033-4` |
| oversight | (icon) | `#msg-704034-4` |
| oversight | (icon) | `#msg-704035-4` |
| oversight | (icon) | `#msg-704036-4` |
| oversight | (icon) | `#msg-704037-4` |
| oversight | (icon) | `#msg-704038-4` |
| oversight | (icon) | `#msg-704039-4` |
| oversight | (icon) | `#msg-704040-8` |
| oversight | (icon) | `#msg-704041-4` |
| oversight | (icon) | `#msg-704042-40` |
| oversight | Home | `/` |
| oversight | Run a node | `/docs/guide/run-a-node` |
| oversight | Run an agent | `/docs/guide/run-an-agent` |
| oversight | Run a validator | `/docs/guide/run-a-validator` |
| oversight | SDK | `/docs/guide/sdk` |
| oversight | Privacy demo | `/oversight` |
| oversight | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| oversight | Constitution | `/docs/reference/constitution` |
| oversight | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| oversight | Chain spec (download) | `/docs/chainspec.json` |
| 404 | Skip to content | `#main` |
| 404 | Scalar Commons | `/` |
| 404 | Network | `/network` |
| 404 | Explorer | `https://explorer.scalarnet.io/` |
| 404 | Docs | `/docs/` |
| 404 | Faucet | `/faucet` |
| 404 | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| 404 | Get started | `/docs/guide/run-an-agent` |
| 404 | Home | `/` |
| 404 | Search the docs | `/docs/` |
| 404 | Run a node | `/docs/guide/run-a-node` |
| 404 | Run an agent | `/docs/guide/run-an-agent` |
| 404 | Run a validator | `/docs/guide/run-a-validator` |
| 404 | SDK | `/docs/guide/sdk` |
| 404 | Privacy demo | `/oversight` |
| 404 | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| 404 | Constitution | `/docs/reference/constitution` |
| 404 | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| 404 | Chain spec (download) | `/docs/chainspec.json` |
| observatory-redirect | Skip to content | `#main` |
| observatory-redirect | Scalar Commons | `/` |
| observatory-redirect | Network | `/network` |
| observatory-redirect | Explorer | `https://explorer.scalarnet.io/` |
| observatory-redirect | Docs | `/docs/` |
| observatory-redirect | Faucet | `/faucet` |
| observatory-redirect | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| observatory-redirect | Get started | `/docs/guide/run-an-agent` |
| observatory-redirect | 5Ck5SL…EAPT | `https://explorer.scalarnet.io/account/5Ck5SLSHYac6WFt5UZRSsdJjwmpSZq85fd5TRNAdZQVzEAPT` |
| observatory-redirect | 1,167,830 | `https://explorer.scalarnet.io/block/1167830` |
| observatory-redirect | 5EXafH…5r5Y | `https://explorer.scalarnet.io/account/5EXafHTU8EqCiszgQh6TVx7sZE7v3VQmvCyNVmsmrDzP5r5Y` |
| observatory-redirect | 1,167,833 | `https://explorer.scalarnet.io/block/1167833` |
| observatory-redirect | 5FCfAo…FE7n | `https://explorer.scalarnet.io/account/5FCfAonRZgTFrTd9HREEyeJjDpT397KMzizE6T3DvebLFE7n` |
| observatory-redirect | 1,167,838 | `https://explorer.scalarnet.io/block/1167838` |
| observatory-redirect | 5GNJqT…xiZY | `https://explorer.scalarnet.io/account/5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY` |
| observatory-redirect | 1,167,842 | `https://explorer.scalarnet.io/block/1167842` |
| observatory-redirect | 5HKPmK…4ns8 | `https://explorer.scalarnet.io/account/5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8` |
| observatory-redirect | 1,167,848 | `https://explorer.scalarnet.io/block/1167848` |
| observatory-redirect | 5HjKj1…tbYe | `https://explorer.scalarnet.io/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe` |
| observatory-redirect | 1,167,840 | `https://explorer.scalarnet.io/block/1167840` |
| observatory-redirect | 5Honeo…oJfc | `https://explorer.scalarnet.io/account/5HoneoB6L3ctEoJVxGTHMNBVVakCW8YPyedCzsXp4fM2oJfc` |
| observatory-redirect | 1,167,847 | `https://explorer.scalarnet.io/block/1167847` |
| observatory-redirect | 5HpG9w…SWFc | `https://explorer.scalarnet.io/account/5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc` |
| observatory-redirect | 1,167,845 | `https://explorer.scalarnet.io/block/1167845` |
| observatory-redirect | 1,167,846 | `https://explorer.scalarnet.io/block/1167846` |
| observatory-redirect | 1,167,844 | `https://explorer.scalarnet.io/block/1167844` |
| observatory-redirect | 1,167,843 | `https://explorer.scalarnet.io/block/1167843` |
| observatory-redirect | 1,167,841 | `https://explorer.scalarnet.io/block/1167841` |
| observatory-redirect | 1,167,839 | `https://explorer.scalarnet.io/block/1167839` |
| observatory-redirect | 1,167,837 | `https://explorer.scalarnet.io/block/1167837` |
| observatory-redirect | Open in explorer | `https://explorer.scalarnet.io/blocks` |
| observatory-redirect | 5DejGJ…yxsE | `https://explorer.scalarnet.io/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| observatory-redirect | 5FxmBm…duiA | `https://explorer.scalarnet.io/account/5FxmBmmd4ujrU5tvxq8ATq3nCbA2Gw8yfMiko7dKRT8GduiA` |
| observatory-redirect | All activity in the explorer | `https://explorer.scalarnet.io/activity` |
| observatory-redirect | 5CexT5…nGB5 | `https://explorer.scalarnet.io/account/5CexT5Tyu6e9c5agRxwfMuQu73hK9n9oxW9kuYhKdRqBnGB5` |
| observatory-redirect | 953,276 | `https://explorer.scalarnet.io/block/953276` |
| observatory-redirect | 5GLCeN…VqGw | `https://explorer.scalarnet.io/account/5GLCeNQyUH9BEftJ3sdXDS4rYxMTSqp2JbdWxnZZXQNnVqGw` |
| observatory-redirect | 947,769 | `https://explorer.scalarnet.io/block/947769` |
| observatory-redirect | 5EoLFT…MRtZ | `https://explorer.scalarnet.io/account/5EoLFT2EPqX43R9Bs7J76ChoFUfbBLUyLQPhq3LSrSKHMRtZ` |
| observatory-redirect | 934,777 | `https://explorer.scalarnet.io/block/934777` |
| observatory-redirect | 5DSTm7…Y4FZ | `https://explorer.scalarnet.io/account/5DSTm7o2cYoadTdpwnmqNiCv9Sf8CQUBUNPRpMZixMhSY4FZ` |
| observatory-redirect | 934,775 | `https://explorer.scalarnet.io/block/934775` |
| observatory-redirect | 5CrYaQ…zk61 | `https://explorer.scalarnet.io/account/5CrYaQEsGuhy4kPfneSbEdpB9FgT5GQetDL5NqBaacZzzk61` |
| observatory-redirect | 932,805 | `https://explorer.scalarnet.io/block/932805` |
| observatory-redirect | 5EcdFx…zPwa | `https://explorer.scalarnet.io/account/5EcdFxGPd4eFbDeq2RLNZFwBk3d8u55486vngPYKwqm9zPwa` |
| observatory-redirect | 932,802 | `https://explorer.scalarnet.io/block/932802` |
| observatory-redirect | 5F1Y7s…Dbcs | `https://explorer.scalarnet.io/account/5F1Y7sJbN9ezqSets2PzLaxdq1nmGmLuFs5qm2Hq6fkQDbcs` |
| observatory-redirect | 932,087 | `https://explorer.scalarnet.io/block/932087` |
| observatory-redirect | 5HYuhs…YPtr | `https://explorer.scalarnet.io/account/5HYuhsU99rkof2VF6S7RznV3hnXTvqAQVoTetu3SaKFrYPtr` |
| observatory-redirect | 932,084 | `https://explorer.scalarnet.io/block/932084` |
| observatory-redirect | 5GEb1a…2YcC | `https://explorer.scalarnet.io/account/5GEb1aEz8xAXpNJ3KcUFT4JefoGkybeqxkuBoitv65KX2YcC` |
| observatory-redirect | 932,081 | `https://explorer.scalarnet.io/block/932081` |
| observatory-redirect | 5H19Vs…rsRV | `https://explorer.scalarnet.io/account/5H19VsfjJtAEMDG7PAF1WP6wCGus8nPn8dNXwQwCXPW5rsRV` |
| observatory-redirect | 932,078 | `https://explorer.scalarnet.io/block/932078` |
| observatory-redirect | 907,929 | `https://explorer.scalarnet.io/block/907929` |
| observatory-redirect | 813,625 | `https://explorer.scalarnet.io/block/813625` |
| observatory-redirect | 543,472 | `https://explorer.scalarnet.io/block/543472` |
| observatory-redirect | 527,277 | `https://explorer.scalarnet.io/block/527277` |
| observatory-redirect | runtime-history.json (download) | `runtime-history.json` |
| observatory-redirect | status.json (download) | `status.json` |
| observatory-redirect | posture.json (download) | `posture.json` |
| observatory-redirect | Home | `/` |
| observatory-redirect | Run a node | `/docs/guide/run-a-node` |
| observatory-redirect | Run an agent | `/docs/guide/run-an-agent` |
| observatory-redirect | Run a validator | `/docs/guide/run-a-validator` |
| observatory-redirect | SDK | `/docs/guide/sdk` |
| observatory-redirect | Privacy demo | `/oversight` |
| observatory-redirect | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| observatory-redirect | Constitution | `/docs/reference/constitution` |
| observatory-redirect | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| observatory-redirect | Chain spec (download) | `/docs/chainspec.json` |
| docs-home | Skip to content | `#VPContent` |
| docs-home | Scalar Commons | `https://scalarnet.io/` |
| docs-home | Network | `https://scalarnet.io/network` |
| docs-home | Explorer | `https://explorer.scalarnet.io/` |
| docs-home | Docs | `/docs/` |
| docs-home | Faucet | `https://scalarnet.io/faucet` |
| docs-home | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| docs-home | Polkadot SDK | `https://github.com/paritytech/polkadot-sdk` |
| docs-home | Run a node Build the node from source, d | `/docs/guide/run-a-node` |
| docs-home | Run an agent Register an agent with the  | `/docs/guide/run-an-agent` |
| docs-home | Run a validator Take a Linux machine int | `/docs/guide/run-a-validator` |
| docs-home | RPC reference | `/docs/reference/rpc` |
| docs-home | Token model | `/docs/reference/token-model` |
| docs-home | Constitution | `/docs/reference/constitution` |
| docs-home | Messages pallet | `/docs/reference/messages` |
| docs-home | Message envelope | `/docs/reference/messaging` |
| docs-home | Message privacy: what an operator can re | `https://scalarnet.io/oversight` |
| docs-article | Skip to content | `#VPContent` |
| docs-article | Scalar Commons | `https://scalarnet.io/` |
| docs-article | Network | `https://scalarnet.io/network` |
| docs-article | Explorer | `https://explorer.scalarnet.io/` |
| docs-article | Docs | `/docs/` |
| docs-article | Faucet | `https://scalarnet.io/faucet` |
| docs-article | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| docs-article | Run a node | `/docs/guide/run-a-node` |
| docs-article | Run an agent | `/docs/guide/run-an-agent` |
| docs-article | Agent on the public testnet | `/docs/guide/run-an-agent-public-testnet` |
| docs-article | Run a validator | `/docs/guide/run-a-validator` |
| docs-article | Testnet tester guide | `/docs/guide/testnet-tester-guide` |
| docs-article | SDK usage | `/docs/guide/sdk` |
| docs-article | Messaging with the SDK | `/docs/guide/messaging-sdk` |
| docs-article | RPC reference | `/docs/reference/rpc` |
| docs-article | Token model | `/docs/reference/token-model` |
| docs-article | Constitution | `/docs/reference/constitution` |
| docs-article | Messages pallet | `/docs/reference/messages` |
| docs-article | Message envelope | `/docs/reference/messaging` |
| docs-article | Message privacy: what an operator can re | `https://scalarnet.io/oversight` |
| docs-article | Prerequisites | `#prerequisites` |
| docs-article | Build | `#build` |
| docs-article | Chain specs | `#chain-specs` |
| docs-article | Chain properties | `#chain-properties` |
| docs-article | Genesis allocation | `#genesis-allocation` |
| docs-article | Generate the raw chainspec | `#generate-the-raw-chainspec` |
| docs-article | Join the devnet as a full node | `#join-the-devnet-as-a-full-node` |
| docs-article | Verify it joined | `#verify-it-joined` |
| docs-article | Devnet topology | `#devnet-topology` |
| docs-article | Reaching a remote RPC | `#reaching-a-remote-rpc` |
| docs-article | Run as a validator | `#run-as-a-validator` |
| docs-article | 1. Start with --validator | `#_1-start-with-validator` |
| docs-article | 2. Generate and register session keys | `#_2-generate-and-register-session-keys` |
| docs-article | Fault tolerance | `#fault-tolerance` |
| docs-article | What this devnet is not | `#what-this-devnet-is-not` |
| docs-article | fault tolerance | `#fault-tolerance` |
| docs-article | ss58-registry | `https://github.com/paritytech/ss58-registry` |
| docs-article | the token model | `/docs/reference/token-model` |
| docs-article | the RPC reference | `/docs/reference/rpc#chain-and-system` |
| docs-article | Polkadot-JS Apps | `https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944` |
| docs-article | the SDK | `/docs/guide/sdk#connect` |
| docs-article | Next page Run an agent | `/docs/guide/run-an-agent` |
| docs-validator | Skip to content | `#VPContent` |
| docs-validator | Scalar Commons | `https://scalarnet.io/` |
| docs-validator | Network | `https://scalarnet.io/network` |
| docs-validator | Explorer | `https://explorer.scalarnet.io/` |
| docs-validator | Docs | `/docs/` |
| docs-validator | Faucet | `https://scalarnet.io/faucet` |
| docs-validator | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| docs-validator | Run a node | `/docs/guide/run-a-node` |
| docs-validator | Run an agent | `/docs/guide/run-an-agent` |
| docs-validator | Agent on the public testnet | `/docs/guide/run-an-agent-public-testnet` |
| docs-validator | Run a validator | `/docs/guide/run-a-validator` |
| docs-validator | Testnet tester guide | `/docs/guide/testnet-tester-guide` |
| docs-validator | SDK usage | `/docs/guide/sdk` |
| docs-validator | Messaging with the SDK | `/docs/guide/messaging-sdk` |
| docs-validator | RPC reference | `/docs/reference/rpc` |
| docs-validator | Token model | `/docs/reference/token-model` |
| docs-validator | Constitution | `/docs/reference/constitution` |
| docs-validator | Messages pallet | `/docs/reference/messages` |
| docs-validator | Message envelope | `/docs/reference/messaging` |
| docs-validator | Message privacy: what an operator can re | `https://scalarnet.io/oversight` |
| docs-validator | The numbers, read from the live chain | `#the-numbers-read-from-the-live-chain` |
| docs-validator | 1. The machine | `#_1-the-machine` |
| docs-validator | Ports | `#ports` |
| docs-validator | 2. Get the node | `#_2-get-the-node` |
| docs-validator | Primary: the release binary | `#primary-the-release-binary` |
| docs-validator | Fallback: build from source | `#fallback-build-from-source` |
| docs-validator | 3. Chain spec and node key | `#_3-chain-spec-and-node-key` |
| docs-validator | 4. Run it under systemd | `#_4-run-it-under-systemd` |
| docs-validator | 5. Session keys — on your own node, neve | `#_5-session-keys-—-on-your-own-node-never-the-public-rpc` |
| docs-validator | 6. Stash, bond, keys, intent | `#_6-stash-bond-keys-intent` |
| docs-validator | 7. Wait for the election, and prove it | `#_7-wait-for-the-election-and-prove-it` |
| docs-validator | Operating it | `#operating-it` |
| docs-validator | Monitoring | `#monitoring` |
| docs-validator | Upgrades | `#upgrades` |
| docs-validator | Leaving | `#leaving` |
| docs-validator | If the testnet is reset | `#if-the-testnet-is-reset` |
| docs-validator | Security | `#security` |
| docs-validator | What this walkthrough found | `#what-this-walkthrough-found` |
| docs-validator | §7 | `./run-a-validator#_7-wait-for-the-election-and-prove-it` |
| docs-validator | #172 | `https://github.com/tejaspatil1936/scalar-commons-v4/issues/172` |
| docs-validator | What to do on a reset | `#if-the-testnet-is-reset` |
| docs-validator | #159 | `https://github.com/tejaspatil1936/scalar-commons-v4/issues/159` |
| docs-validator | .github/workflows/release.yml | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/.github/workflows/release.yml` |
| docs-validator | v0.306.0 | `https://github.com/tejaspatil1936/scalar-commons-v4/releases/tag/v0.306.0` |
| docs-validator | chainspec.json (download) | `https://scalarnet.io/docs/chainspec.json` |
| docs-validator | https://explorer.scalarnet.io/block/7667 | `https://explorer.scalarnet.io/block/766726` |
| docs-validator | Previous page Agent on the public testne | `/docs/guide/run-an-agent-public-testnet` |
| docs-validator | Next page Testnet tester guide | `/docs/guide/testnet-tester-guide` |
| docs-404 | Skip to content | `#VPContent` |
| docs-404 | Scalar Commons | `https://scalarnet.io/` |
| docs-404 | Network | `https://scalarnet.io/network` |
| docs-404 | Explorer | `https://explorer.scalarnet.io/` |
| docs-404 | Docs | `/docs/` |
| docs-404 | Faucet | `https://scalarnet.io/faucet` |
| docs-404 | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| docs-404 | Go to the documentation home | `/docs/` |
| explorer-home | Skip to content | `#main` |
| explorer-home | Scalar Commons | `https://scalarnet.io/` |
| explorer-home | Network | `https://scalarnet.io/network` |
| explorer-home | Explorer | `https://explorer.scalarnet.io/` |
| explorer-home | Docs | `https://scalarnet.io/docs/` |
| explorer-home | Faucet | `https://scalarnet.io/faucet` |
| explorer-home | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-home | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-home | View all | `/blocks` |
| explorer-home | 1,167,865 | `/block/1167865` |
| explorer-home | 5HpG9w…SWFc | `/account/5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc` |
| explorer-home | 1,167,864 | `/block/1167864` |
| explorer-home | 1,167,863 | `/block/1167863` |
| explorer-home | 5Honeo…oJfc | `/account/5HoneoB6L3ctEoJVxGTHMNBVVakCW8YPyedCzsXp4fM2oJfc` |
| explorer-home | 1,167,862 | `/block/1167862` |
| explorer-home | 1,167,861 | `/block/1167861` |
| explorer-home | 5HKPmK…4ns8 | `/account/5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8` |
| explorer-home | 1,167,860 | `/block/1167860` |
| explorer-home | 5Ck5SL…EAPT | `/account/5Ck5SLSHYac6WFt5UZRSsdJjwmpSZq85fd5TRNAdZQVzEAPT` |
| explorer-home | 1,167,859 | `/block/1167859` |
| explorer-home | 5HjKj1…tbYe | `/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe` |
| explorer-home | 1,167,858 | `/block/1167858` |
| explorer-home | 5EXafH…5r5Y | `/account/5EXafHTU8EqCiszgQh6TVx7sZE7v3VQmvCyNVmsmrDzP5r5Y` |
| explorer-home | 1,167,857 | `/block/1167857` |
| explorer-home | 1,167,856 | `/block/1167856` |
| explorer-home | View all | `/activity` |
| explorer-home | 5DejGJ…yxsE | `/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| explorer-home | 5FxmBm…duiA | `/account/5FxmBmmd4ujrU5tvxq8ATq3nCbA2Gw8yfMiko7dKRT8GduiA` |
| explorer-home | 5HNCV2…k2Qi | `/account/5HNCV23rassfd8JDFKwCF7DLmgqyQwsA9D34tB7bm5Urk2Qi` |
| explorer-home | 5GEpUK…Q6im | `/account/5GEpUKLN4MuQGrXJCS4dpkq24Hpw95rquPNjE9rsYAZQQ6im` |
| explorer-home | Home | `https://scalarnet.io/` |
| explorer-home | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-home | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-home | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-home | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-home | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-home | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-home | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-home | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-home | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-blocks | Skip to content | `#main` |
| explorer-blocks | Scalar Commons | `https://scalarnet.io/` |
| explorer-blocks | Network | `https://scalarnet.io/network` |
| explorer-blocks | Explorer | `https://explorer.scalarnet.io/` |
| explorer-blocks | Docs | `https://scalarnet.io/docs/` |
| explorer-blocks | Faucet | `https://scalarnet.io/faucet` |
| explorer-blocks | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-blocks | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-blocks | 1,167,868 | `/block/1167868` |
| explorer-blocks | 0xd7acd7…1fcd02 | `/block/0xd7acd753cd464b7cb097787ed3f0c35643c85092d01cd18ea3424f046c1fcd02` |
| explorer-blocks | 5Honeo…oJfc | `/account/5HoneoB6L3ctEoJVxGTHMNBVVakCW8YPyedCzsXp4fM2oJfc` |
| explorer-blocks | 1,167,867 | `/block/1167867` |
| explorer-blocks | 0x23ba50…4460df | `/block/0x23ba5026da2b2bcb29b4e3af87b8282085c2b2f9707d6f788cb366e4444460df` |
| explorer-blocks | 5FCfAo…FE7n | `/account/5FCfAonRZgTFrTd9HREEyeJjDpT397KMzizE6T3DvebLFE7n` |
| explorer-blocks | 1,167,866 | `/block/1167866` |
| explorer-blocks | 0xdae168…e5e121 | `/block/0xdae16880c66503ee04e4175284b5b8196ceb8b4e0ba4ed861f0e9f9917e5e121` |
| explorer-blocks | 1,167,865 | `/block/1167865` |
| explorer-blocks | 0x272731…8364f2 | `/block/0x27273192f62cef141962851bf71d0c29b27f6a14001993b8f4afb1fcf98364f2` |
| explorer-blocks | 5HpG9w…SWFc | `/account/5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc` |
| explorer-blocks | 1,167,864 | `/block/1167864` |
| explorer-blocks | 0xc13c0d…9c2f98 | `/block/0xc13c0d71ea9ab0106cbcf80f7e189e76f54e2e1930cfbc388cf0f137979c2f98` |
| explorer-blocks | 1,167,863 | `/block/1167863` |
| explorer-blocks | 0x33e380…29349c | `/block/0x33e380dbe359330eceb38c7801fae95b6f502410da65afa643403cacb129349c` |
| explorer-blocks | 1,167,862 | `/block/1167862` |
| explorer-blocks | 0xe3e7c9…2a2804 | `/block/0xe3e7c9e3465d98c83a377ec2c994abeb93db86461c634a6617e6f88a402a2804` |
| explorer-blocks | 1,167,861 | `/block/1167861` |
| explorer-blocks | 0x53c1a4…7482ed | `/block/0x53c1a46bf00cdb88da081d0532fbad2e1a56e16325293608a33de6e3e47482ed` |
| explorer-blocks | 5HKPmK…4ns8 | `/account/5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8` |
| explorer-blocks | 1,167,860 | `/block/1167860` |
| explorer-blocks | 0x5f3136…8b8ec6 | `/block/0x5f3136ac40196e65beb398d6b790e5fbd798aeb998fbb36a4f98aaf3f78b8ec6` |
| explorer-blocks | 5Ck5SL…EAPT | `/account/5Ck5SLSHYac6WFt5UZRSsdJjwmpSZq85fd5TRNAdZQVzEAPT` |
| explorer-blocks | 1,167,859 | `/block/1167859` |
| explorer-blocks | 0xbe8065…373d90 | `/block/0xbe8065449b9fea272f1a720c9f26384baf917a34d118ff1b3db3189cc1373d90` |
| explorer-blocks | 5HjKj1…tbYe | `/account/5HjKj1CGzypfsSA9KYh6Qgw8pUEymz3WLHB23AFL9okxtbYe` |
| explorer-blocks | 1,167,858 | `/block/1167858` |
| explorer-blocks | 0x6b4dec…76c892 | `/block/0x6b4dec5d2b378c947a68414b51fa5ceb3a51ea5180eb4db0cb8bec762776c892` |
| explorer-blocks | 5EXafH…5r5Y | `/account/5EXafHTU8EqCiszgQh6TVx7sZE7v3VQmvCyNVmsmrDzP5r5Y` |
| explorer-blocks | 1,167,857 | `/block/1167857` |
| explorer-blocks | 0x7a89b8…cdfdf0 | `/block/0x7a89b8a646591a2ff8a379decb7294268650804fd3b765fd54281f7fddcdfdf0` |
| explorer-blocks | 1,167,856 | `/block/1167856` |
| explorer-blocks | 0xd1a6c9…6f6b83 | `/block/0xd1a6c9891f6a0bcb985874a103f947ccace83cc0b7d0784ca804418c3a6f6b83` |
| explorer-blocks | 1,167,855 | `/block/1167855` |
| explorer-blocks | 0x4056e0…312320 | `/block/0x4056e089878650bf6b93063abc61169093259783abb51d3b7d7e19b0a3312320` |
| explorer-blocks | 1,167,854 | `/block/1167854` |
| explorer-blocks | 0x6884ea…71ba74 | `/block/0x6884ea58ac41f11e04a2e1b38fd1c35f88f741b1ee2368404d63f9816371ba74` |
| explorer-blocks | 1,167,853 | `/block/1167853` |
| explorer-blocks | 0xdaad89…4a5e22 | `/block/0xdaad8923c5aaeebe80747cf125478382d7d2e17e4fe4702e571cbf7b814a5e22` |
| explorer-blocks | 1,167,852 | `/block/1167852` |
| explorer-blocks | 0x17e821…a06f13 | `/block/0x17e8214cfd64f9bb9522f96f8ac9a440a85e05d1499abc733ee2e5d2e7a06f13` |
| explorer-blocks | 1,167,851 | `/block/1167851` |
| explorer-blocks | 0x13dda7…6b3d9c | `/block/0x13dda700a545731716fe81c1fe2f6414a83c42cfe077d97299a6d663886b3d9c` |
| explorer-blocks | 1,167,850 | `/block/1167850` |
| explorer-blocks | 0xf66922…533e05 | `/block/0xf669227b25c9695eaa66b1235c23e2b8b8c25a8587cbcc82c77128ee04533e05` |
| explorer-blocks | 1,167,849 | `/block/1167849` |
| explorer-blocks | 0x9d93ee…f58165 | `/block/0x9d93ee83e73ac01aa2cb07559845c70b20d23ee4cbcce292f4b53a0916f58165` |
| explorer-blocks | 1,167,848 | `/block/1167848` |
| explorer-blocks | 0x999b00…edfa10 | `/block/0x999b009b77cd2ead39004172aabe9ea92f6202098b7a77c8d2ab07b23dedfa10` |
| explorer-blocks | 1,167,847 | `/block/1167847` |
| explorer-blocks | 0x475891…6dabb4 | `/block/0x475891fec89cedf223cb2856cb4670ecdd51746b19ad3d51d0e3282ee86dabb4` |
| explorer-blocks | 1,167,846 | `/block/1167846` |
| explorer-blocks | 0xd38a01…278a4b | `/block/0xd38a0120ee044b2d0a7c120664f75d12d340f6b46d0efac523709a45de278a4b` |
| explorer-blocks | 1,167,845 | `/block/1167845` |
| explorer-blocks | 0x64fb4d…716218 | `/block/0x64fb4d3a82c55ea17562a5f653f438a95edbddda5f7192f0845fc3c8eb716218` |
| explorer-blocks | 1,167,844 | `/block/1167844` |
| explorer-blocks | 0xa1e572…16776d | `/block/0xa1e57251bbc2f10e0769721a71510bc02c87a28a16ce267b95ef1969b416776d` |
| explorer-blocks | Next | `/blocks?offset=25` |
| explorer-blocks | Home | `https://scalarnet.io/` |
| explorer-blocks | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-blocks | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-blocks | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-blocks | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-blocks | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-blocks | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-blocks | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-blocks | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-blocks | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-activity | Skip to content | `#main` |
| explorer-activity | Scalar Commons | `https://scalarnet.io/` |
| explorer-activity | Network | `https://scalarnet.io/network` |
| explorer-activity | Explorer | `https://explorer.scalarnet.io/` |
| explorer-activity | Docs | `https://scalarnet.io/docs/` |
| explorer-activity | Faucet | `https://scalarnet.io/faucet` |
| explorer-activity | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-activity | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-activity | All | `/activity` |
| explorer-activity | Agreements | `/activity?kind=agreement` |
| explorer-activity | Disputes | `/activity?kind=dispute` |
| explorer-activity | Messages | `/activity?kind=message` |
| explorer-activity | Registrations | `/activity?kind=registration` |
| explorer-activity | Slashes | `/activity?kind=slash` |
| explorer-activity | 1,167,379 | `/block/1167379` |
| explorer-activity | 5DejGJ…yxsE | `/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| explorer-activity | 1,167,376 | `/block/1167376` |
| explorer-activity | 5FxmBm…duiA | `/account/5FxmBmmd4ujrU5tvxq8ATq3nCbA2Gw8yfMiko7dKRT8GduiA` |
| explorer-activity | 1,165,870 | `/block/1165870` |
| explorer-activity | 5HNCV2…k2Qi | `/account/5HNCV23rassfd8JDFKwCF7DLmgqyQwsA9D34tB7bm5Urk2Qi` |
| explorer-activity | 1,165,866 | `/block/1165866` |
| explorer-activity | 5GEpUK…Q6im | `/account/5GEpUKLN4MuQGrXJCS4dpkq24Hpw95rquPNjE9rsYAZQQ6im` |
| explorer-activity | 1,164,834 | `/block/1164834` |
| explorer-activity | 1,164,509 | `/block/1164509` |
| explorer-activity | 1,164,098 | `/block/1164098` |
| explorer-activity | 1,163,894 | `/block/1163894` |
| explorer-activity | 1,162,301 | `/block/1162301` |
| explorer-activity | 1,162,297 | `/block/1162297` |
| explorer-activity | 1,161,994 | `/block/1161994` |
| explorer-activity | 1,161,992 | `/block/1161992` |
| explorer-activity | 1,160,411 | `/block/1160411` |
| explorer-activity | 1,159,736 | `/block/1159736` |
| explorer-activity | 1,159,454 | `/block/1159454` |
| explorer-activity | 1,159,449 | `/block/1159449` |
| explorer-activity | 1,158,649 | `/block/1158649` |
| explorer-activity | 1,157,803 | `/block/1157803` |
| explorer-activity | 1,156,910 | `/block/1156910` |
| explorer-activity | 1,156,793 | `/block/1156793` |
| explorer-activity | 1,156,790 | `/block/1156790` |
| explorer-activity | 1,155,933 | `/block/1155933` |
| explorer-activity | 1,154,942 | `/block/1154942` |
| explorer-activity | 1,154,219 | `/block/1154219` |
| explorer-activity | 1,153,895 | `/block/1153895` |
| explorer-activity | Next | `/activity?offset=25` |
| explorer-activity | Home | `https://scalarnet.io/` |
| explorer-activity | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-activity | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-activity | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-activity | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-activity | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-activity | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-activity | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-activity | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-activity | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-search-miss | Skip to content | `#main` |
| explorer-search-miss | Scalar Commons | `https://scalarnet.io/` |
| explorer-search-miss | Network | `https://scalarnet.io/network` |
| explorer-search-miss | Explorer | `https://explorer.scalarnet.io/` |
| explorer-search-miss | Docs | `https://scalarnet.io/docs/` |
| explorer-search-miss | Faucet | `https://scalarnet.io/faucet` |
| explorer-search-miss | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-search-miss | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-search-miss | Home | `https://scalarnet.io/` |
| explorer-search-miss | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-search-miss | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-search-miss | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-search-miss | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-search-miss | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-search-miss | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-search-miss | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-search-miss | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-search-miss | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-block | Skip to content | `#main` |
| explorer-block | Scalar Commons | `https://scalarnet.io/` |
| explorer-block | Network | `https://scalarnet.io/network` |
| explorer-block | Explorer | `https://explorer.scalarnet.io/` |
| explorer-block | Docs | `https://scalarnet.io/docs/` |
| explorer-block | Faucet | `https://scalarnet.io/faucet` |
| explorer-block | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-block | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-block | Explorer | `/` |
| explorer-block | Previous block | `/block/1167823` |
| explorer-block | Next block | `/block/1167825` |
| explorer-block | 0x97c195c37379597b571016cfefbac61375ab23 | `/block/0x97c195c37379597b571016cfefbac61375ab230efbb42e0a20b0d43c3d3e2579` |
| explorer-block | 5GNJqT…xiZY | `/account/5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY` |
| explorer-block | Extrinsics (1) | `/block/1167824` |
| explorer-block | Events (1) | `/block/1167824?tab=events` |
| explorer-block | 1,167,824-0 | `/extrinsic/1167824/0` |
| explorer-block | Home | `https://scalarnet.io/` |
| explorer-block | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-block | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-block | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-block | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-block | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-block | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-block | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-block | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-block | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-extrinsic | Skip to content | `#main` |
| explorer-extrinsic | Scalar Commons | `https://scalarnet.io/` |
| explorer-extrinsic | Network | `https://scalarnet.io/network` |
| explorer-extrinsic | Explorer | `https://explorer.scalarnet.io/` |
| explorer-extrinsic | Docs | `https://scalarnet.io/docs/` |
| explorer-extrinsic | Faucet | `https://scalarnet.io/faucet` |
| explorer-extrinsic | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-extrinsic | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-extrinsic | Explorer | `/` |
| explorer-extrinsic | Block 1,167,824 | `/block/1167824` |
| explorer-extrinsic | 1,167,824 | `/block/1167824` |
| explorer-extrinsic | Home | `https://scalarnet.io/` |
| explorer-extrinsic | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-extrinsic | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-extrinsic | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-extrinsic | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-extrinsic | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-extrinsic | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-extrinsic | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-extrinsic | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-extrinsic | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |
| explorer-account | Skip to content | `#main` |
| explorer-account | Scalar Commons | `https://scalarnet.io/` |
| explorer-account | Network | `https://scalarnet.io/network` |
| explorer-account | Explorer | `https://explorer.scalarnet.io/` |
| explorer-account | Docs | `https://scalarnet.io/docs/` |
| explorer-account | Faucet | `https://scalarnet.io/faucet` |
| explorer-account | GitHub | `https://github.com/tejaspatil1936/scalar-commons-v4` |
| explorer-account | Get started | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-account | Explorer | `/` |
| explorer-account | 833,164 | `/block/833164` |
| explorer-account | 1,167,379 | `/block/1167379` |
| explorer-account | Agent activity | `/activity?agent=5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| explorer-account | Extrinsics | `/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE` |
| explorer-account | Activity | `/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE?tab=activity` |
| explorer-account | 1,167,379-1 | `/extrinsic/1167379/1` |
| explorer-account | 1,164,509-1 | `/extrinsic/1164509/1` |
| explorer-account | 1,164,509 | `/block/1164509` |
| explorer-account | 1,161,994-1 | `/extrinsic/1161994/1` |
| explorer-account | 1,161,994 | `/block/1161994` |
| explorer-account | 1,159,454-1 | `/extrinsic/1159454/1` |
| explorer-account | 1,159,454 | `/block/1159454` |
| explorer-account | 1,156,910-1 | `/extrinsic/1156910/1` |
| explorer-account | 1,156,910 | `/block/1156910` |
| explorer-account | 1,153,705-1 | `/extrinsic/1153705/1` |
| explorer-account | 1,153,705 | `/block/1153705` |
| explorer-account | 1,151,140-1 | `/extrinsic/1151140/1` |
| explorer-account | 1,151,140 | `/block/1151140` |
| explorer-account | 1,148,233-1 | `/extrinsic/1148233/1` |
| explorer-account | 1,148,233 | `/block/1148233` |
| explorer-account | 1,145,478-1 | `/extrinsic/1145478/1` |
| explorer-account | 1,145,478 | `/block/1145478` |
| explorer-account | 1,142,764-1 | `/extrinsic/1142764/1` |
| explorer-account | 1,142,764 | `/block/1142764` |
| explorer-account | 1,139,856-1 | `/extrinsic/1139856/1` |
| explorer-account | 1,139,856 | `/block/1139856` |
| explorer-account | 1,137,360-1 | `/extrinsic/1137360/1` |
| explorer-account | 1,137,360 | `/block/1137360` |
| explorer-account | 1,134,500-1 | `/extrinsic/1134500/1` |
| explorer-account | 1,134,500 | `/block/1134500` |
| explorer-account | 1,131,952-1 | `/extrinsic/1131952/1` |
| explorer-account | 1,131,952 | `/block/1131952` |
| explorer-account | 1,129,379-1 | `/extrinsic/1129379/1` |
| explorer-account | 1,129,379 | `/block/1129379` |
| explorer-account | 1,126,752-1 | `/extrinsic/1126752/1` |
| explorer-account | 1,126,752 | `/block/1126752` |
| explorer-account | 1,124,140-1 | `/extrinsic/1124140/1` |
| explorer-account | 1,124,140 | `/block/1124140` |
| explorer-account | 1,120,780-1 | `/extrinsic/1120780/1` |
| explorer-account | 1,120,780 | `/block/1120780` |
| explorer-account | 1,117,799-1 | `/extrinsic/1117799/1` |
| explorer-account | 1,117,799 | `/block/1117799` |
| explorer-account | 1,115,300-1 | `/extrinsic/1115300/1` |
| explorer-account | 1,115,300 | `/block/1115300` |
| explorer-account | 1,112,535-1 | `/extrinsic/1112535/1` |
| explorer-account | 1,112,535 | `/block/1112535` |
| explorer-account | 1,112,533-1 | `/extrinsic/1112533/1` |
| explorer-account | 1,112,533 | `/block/1112533` |
| explorer-account | 1,112,531-1 | `/extrinsic/1112531/1` |
| explorer-account | 1,112,531 | `/block/1112531` |
| explorer-account | 1,112,345-1 | `/extrinsic/1112345/1` |
| explorer-account | 1,112,345 | `/block/1112345` |
| explorer-account | 1,112,343-1 | `/extrinsic/1112343/1` |
| explorer-account | 1,112,343 | `/block/1112343` |
| explorer-account | Next | `/account/5DejGJWr6b5ThJjSc9t3YnUgeRA3gzE8qyzrcRd9NUnNyxsE?offset=25` |
| explorer-account | Home | `https://scalarnet.io/` |
| explorer-account | Run a node | `https://scalarnet.io/docs/guide/run-a-node` |
| explorer-account | Run an agent | `https://scalarnet.io/docs/guide/run-an-agent` |
| explorer-account | Run a validator | `https://scalarnet.io/docs/guide/run-a-validator` |
| explorer-account | SDK | `https://scalarnet.io/docs/guide/sdk` |
| explorer-account | Privacy demo | `https://scalarnet.io/oversight` |
| explorer-account | Releases | `https://github.com/tejaspatil1936/scalar-commons-v4/releases` |
| explorer-account | Constitution | `https://scalarnet.io/docs/reference/constitution` |
| explorer-account | Security | `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` |
| explorer-account | Chain spec (download) | `https://scalarnet.io/docs/chainspec.json` |

Link check: 263 URLs requested, 3 answered 4xx/5xx or failed.
| url | result |
|---|---|
| `https://explorer.scalarnet.io/blocks` | {'status': 404} |
| `https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md` | {'status': 404} |
| `https://scalarnet.io/network` | {'status': 404} |
