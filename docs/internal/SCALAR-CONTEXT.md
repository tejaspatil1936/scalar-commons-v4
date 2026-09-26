# Scalar Commons v4 — Project Context

**Purpose of this file.** One place that describes the codebase, configuration, environments, machines, deployments, secrets locations (never values), operating procedures and current state, so a new person or agent can pick the project up without the chat history.

**As of:** 12 September 2026 (last verified state). Anything marked *verify* should be re-checked with the command given before being relied on. Nothing in this file is a secret; where a secret exists, only its location and permissions are recorded.

---

## 1. Project in one paragraph

Scalar Commons is a Substrate / Polkadot-SDK layer-1 blockchain (token **CMN**) purpose-built for autonomous AI-agent coordination: agents register with stake, contract with each other through on-chain escrow, declare orchestrator hierarchy, submit off-chain facts through a bonded oracle, and are paid per era from an emission pool bounded by verified work. It runs as a **public testnet at scalarnet.io** (five operator-run validators on one VPS), is open source on GitHub, and is developed largely by a bounded-autonomy pipeline of Claude Code agents ("the factory") with a human (Tejas) as planner/operator and a co-founder (Matthew Rogers, "Matty") on the business side.

---

## 2. People, accounts, external services

| Item | Value |
|---|---|
| Operator / lead engineer | Tejas Patil — GitHub `tejaspatil1936` |
| Co-founder (business) | Matthew Rogers |
| Repository | `github.com/tejaspatil1936/scalar-commons-v4` — public, default branch **`master`** (not `main`) |
| Domain | `scalarnet.io` — registrar GoDaddy; DNS managed there |
| Temporary/previous site | `https://tejaspatil.tech/scalar-commons-v4/` (GitHub Pages, landing + `/docs/`, HTTPS enforced) — still live, superseded by scalarnet.io |
| VPS provider | netcup |
| Coding agents | Claude Code (Max plan). In the `chain` tmux session `echo $ANTHROPIC_API_KEY` must be **empty** (Max plan auth, not API key). The factory uses an API key from `~/.factory/env`. |
| GitHub CLI | `gh` authenticated on the VPS as `tejaspatil1936` (admin on the repo) |

---

## 3. Machines and environments

### 3.1 The VPS (everything runs here)

| Item | Value |
|---|---|
| Host | `152.53.113.104` (hostname `v2202607384283486718`), netcup, Germany |
| OS | Ubuntu (systemd user services + timers) |
| Login | `ssh dev@152.53.113.104` — **key-only** (password auth disabled; never disable an auth path without a proven alternative login) |
| Users | `dev` (all services run as `dev` user units); `sudo` available to `dev` (interactive password) |
| Repo checkout | `/home/dev/scalar-commons-v4` (branch `master`) — **not** `~/Programming/...` (old path, gone) |
| Toolchain | rust 1.85.0, target `wasm32v1-none`, `polkadot-stable2503`; Node 22; `~/.npm-global/bin`, `~/.local/bin` on PATH (gitleaks lives in `~/.local/bin`) |
| tmux sessions used | `chain` (operator work), `launch`, `launch2`, `guide`, `spec306` (Claude Code sessions). `tmux ls` to list; `tmux attach -t <name>`. Claude Code output is lost if not run inside tmux. |
| Kill switch for the factory | `touch ~/STOP_FACTORY` |

### 3.2 Network exposure (ufw, verified 9 Sep 2026)

```
default deny incoming / allow outgoing
allow 22/tcp, 80/tcp, 443/tcp, 30333:30337/tcp (p2p)
deny  9944:9948/tcp (node RPC — loopback only)
```
Verified from an external host: 9944–9948, 8080, 8082 unreachable; 80 answers. *verify:* `sudo ufw status numbered`.

### 3.3 Other environments
- **GitHub Actions** — all CI (see §7).
- **GitHub Pages** — builds landing + docs from `pages.yml` to tejaspatil.tech (kept as fallback).
- **Local laptop** — only used for SSH and browser; nothing runs there.
- **This planning session (Claude, cloud)** — produced the reports/memos; cannot reach GitHub or scalarnet.io directly (proxy), only via WebFetch.

---

## 4. Codebase layout (repo root `scalar-commons-v4/`)

| Path | What it is |
|---|---|
| `node/` | Substrate node binary (chain spec, service, CLI) |
| `runtime/` | Runtime: `runtime/src/lib.rs` wires the 7 pallets; `spec_version` currently **306**; `type EraPayout = ();` (staking inflation off since 305) |
| `pallets/` | `agents`, `escrow`, `oracle`, `emissions`, `auto-params`, `orchestrator`, `constitution` |
| `sdk/` | TypeScript SDK (`@polkadot/api` based); offline + live tests |
| `indexer/` | REST indexer, 24 `/v1/*` endpoints, binds `127.0.0.1:8080`; `reconcile.py`; binds only after a ~3-min backfill |
| `explorer/` | Block explorer web app, `127.0.0.1:8081` |
| `faucet/` | Faucet service, `127.0.0.1:8082`, runs `node dist/index.js` |
| `landing/` | Public site; `npm run build` honours `LANDING_OUT_DIR`; `chain-facts.json` snapshot |
| `docs/` | VitePress docs; `npm run build` honours `DOCS_BASE` (set `/docs/` for scalarnet.io); `docs/.vitepress/config.mts`; `docs/public/chainspec.json` (published raw chain spec with 5 bootnodes); `docs/guide/testnet-tester-guide.md` |
| `experiments/live/` | Economic-gate harness: `node run.mjs --archetype <name|all> --eras N`; six archetypes (honest, wash-trader, sybil, idle, orchestrated, adversarial) |
| `factory/` | Autonomous dev pipeline: `dispatch.sh`, `loop.sh`, `review.sh`, `merge.sh`, `tracker.sh`, `watchdog.sh`, `config.env`, `blocked/` |
| `deploy/` | `deploy/products/` (systemd units + env examples + `install.sh` for indexer/explorer/faucet/keeper); `deploy/public/` (nginx TLS template, `domain.env` [gitignored], `render-config.sh`, `INSTALL.md`, `VERIFY.md`, `redeploy-site.sh`); `deploy/hardening/` (sshd); `deploy/upgrade.md` |
| `scripts/` | `sudo-set-key.mjs`, `apply-upgrade.mjs` (fee preflight, applies wasm via sudo), snapshot scripts |
| `.github/workflows/` | `ci-fast.yml` (job `gate`), `ci-full.yml` (`full`), `ci-node.yml` (`changes`, `landing`, `faucet`, `docs`, `sdk`, `secrets`, `chainspec`), `pages.yml` |
| `.gitleaks.toml` | Allowlists only the ss58 address regex for rule `generic-api-key` |
| Root reports | `ENDGOAL.md`, `TESTNETAUDIT.md`, `AUDIT.md`, `WEEKCHECK.md`, `TODAY-PLAN.md`, `CI-NODE.md`, `UPGRADE-305.md`, `UPGRADE-306.md`, `AUDIT-FIX-PLAN.md`, `PUBLIC-LAUNCH.md`, `CLAUDE.md` |

---

## 5. Chain: parameters and on-chain identities (public)

| Item | Value |
|---|---|
| Chain name | "Scalar Commons Local Testnet" (baked into chain spec; renaming needs a coordinated restart) |
| specName / specVersion | `scalar-commons` / **306** (305 applied at block #527277; 306 applied ~10–11 Sep 2026) |
| Consensus | BABE + GRANDPA; Staking + OpenGov; 5 validators (alice…, all operator-run) |
| Block time / era | 6 s / 3,600 blocks (~6 h) |
| ss58 / decimals | 42 / 12 |
| Supply cap | 100,000,000,000 CMN (stated on landing; not re-verified from constants) |
| Registration | 50 CMN fee, min stake 1,000 CMN, max 1,000,000 CMN/agent, unstake cooldown ~7 days |
| Completion fee | 50 bps (auto-params moved it 25→50 after RingFarmingDetected) |
| Dispute bond | 2% of value, min 1 CMN |
| Emissions (306) | Pot bounded by qualifying escrow volume (α, auto-params); self-dealing/lineage excluded; **live re-measurement pending** (#164 open until PASS) |
| Staking | `EraPayout = ()` (validators earn nothing); MinValidatorBond 0, MinNominatorBond 0, ValidatorCount 5 (D11: raise to 7, bonds 1,000/100 when an external validator joins) |
| Sudo key (public address) | `5DFASjqmCBrMfRsHDzQyXGodfWL4Bj1uK6X2U3jBEEoPh8ZN` (operator key, funded ~10,000 CMN; rotated off //Alice; to be removed at mainnet) |
| Faucet address | `5Ff3A2zFHT5zYujb2gaF4s8z5CALoCdizSVstTqTtttCjezQ` (~5,000,000 CMN; drip 1,100 CMN; 1 drip/60 min/address, 5/60 min/IP; reserve 1,000 CMN) |
| Alice (dev) address | `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY` — must never be Sudo again |
| Keeper | `scalar-keeper.timer` every 15 min → `scalar-keeper.service` (oneshot) submits `settle_era` when due |
| Backups | Pre-upgrade backups under `~/upgrade-backup/<timestamp>/` (e.g. `20260909T071446Z`) |

---

## 6. Deployments on the VPS

### 6.1 Validators (systemd user services, one per node)
`scalar-node-alice` … five units; flags on all five: `--rpc-methods safe --rpc-rate-limit 300 --rpc-max-connections 100`, RPC on `127.0.0.1:9944–9948`, p2p `30333–30337`. Rolling restart procedure: one node at a time, wait for peers to recover. *verify:* `tr '\0' ' ' < /proc/$(pgrep -f scalar-node-alice | head -1)/cmdline`.

### 6.2 Products (systemd user services)
| Unit | Port | Notes |
|---|---|---|
| `scalar-indexer` | 127.0.0.1:8080 | `/v1/status` etc.; 502 for ~3 min after start (backfill) |
| `scalar-explorer` | 127.0.0.1:8081 | |
| `scalar-faucet` | 127.0.0.1:8082 | env `~/.config/scalar-commons/faucet.env`; trusts `X-Forwarded-For` (nginx sets it to the real peer only) |
| `scalar-keeper` (+ timer) | — | settle_era submitter |
| **Known bug #155** | | products do not reconnect after a node websocket drop → restart them after any node restart: `systemctl --user restart scalar-indexer scalar-faucet scalar-explorer` |

Health checks: `curl -s http://127.0.0.1:8080/v1/status`, `.../8082/health`, `curl -sI http://127.0.0.1:8081/`.

### 6.3 Public edge (nginx + Let's Encrypt)
- Config: `/etc/nginx/sites-available/scalarnet` → enabled; generated from `deploy/public/` template with `DOMAIN=scalarnet.io` (byte-identical, sha256 recorded in PUBLIC-LAUNCH.md).
- Certificate: `/etc/letsencrypt/live/scalarnet.io/{fullchain,privkey}.pem`, one cert for 5 names, ACME webroot `/var/www/acme`, `certbot.timer` enabled, dry-run OK.
- Static site root: `/var/www/scalarnet/landing` and `/var/www/scalarnet/docs` (owned by `dev`); rebuilt by `bash deploy/public/redeploy-site.sh` (manual until #158 timer lands).
- Hostnames → backends:

| Host | Backend | Key directives |
|---|---|---|
| `scalarnet.io` | static landing, `/docs/` alias | HSTS, nosniff, X-Frame DENY |
| `rpc.scalarnet.io` (wss) | 127.0.0.1:9944 | websocket upgrade (HTTP/1.1), `Host 127.0.0.1:9944`, `Origin ""`, limit_conn 20, body 1m, CORS *, OPTIONS 204 |
| `api.scalarnet.io` | 127.0.0.1:8080 | limit_req 20r/s burst 40, CORS * |
| `explorer.scalarnet.io` | 127.0.0.1:8081 | |
| `faucet.scalarnet.io` | 127.0.0.1:8082 | limit_req 10r/m burst 5, body 16k, `X-Forwarded-For $remote_addr` (forgery-proof) |
| `http://*` | → 301 https | ACME path exempt |

Externally verified 9 Sep: TLS ok on all 5 names, `author_rotateKeys` refused (-32601), ws upgrade 101, 20 ws conns then 429, faucet 6×200/9×429.

### 6.4 DNS (GoDaddy)
A records `@`, `rpc`, `api`, `explorer`, `faucet` → `152.53.113.104`.

---

## 7. CI, branch protection, repo policy

- Required status checks on `master` (strict = true, enforce_admins = true): `gate`, `full`, `landing`, `faucet`, `docs`, `sdk`, `changes`, `chainspec`, `secrets`. *verify:* `gh api repos/tejaspatil1936/scalar-commons-v4/branches/master/protection/required_status_checks --jq '{strict:.strict,contexts:.contexts}'`.
- `secrets` job runs gitleaks with `.gitleaks.toml` (ss58-only allowlist) and a planted-token control assembled from halves (so the control itself is never a literal secret).
- `chainspec` job checks `docs/public/chainspec.json`.
- Rust CI (`gate`, `full`) takes ~20 min each.
- Rule: never weaken a check to make it pass; a failure is a finding. Issue gates must be single-line (backslash continuations get mangled).

---

## 8. The factory (autonomous development pipeline)

| Piece | Behaviour |
|---|---|
| Issues | Labels `tier:T0` (human only, never dispatched), `tier:T1` (agent PR, human merge), `tier:T2`/`tier:T3` (autonomous), plus `ready`, `in-progress`, `agent-reviewed`, `needs-human`. Each issue carries a pre-tested **gate** command that is RED before the fix and GREEN after. |
| `dispatch.sh` | Hourly timer; picks `ready` T2/T3 issues; `gate_from_issue()` validates with `bash -n`; skips issues with open PRs; worktrees `wt-<issue>` |
| `loop.sh` | Bounded Ralph loop per issue |
| `review.sh` | Three fresh-context lenses → `VERDICT: PASS/FAIL` (ERROR ≠ FAIL); diff via stdin, capped at `MAX_REVIEW_DIFF_LINES=2500`; SHA-bound `agent-reviewed` label |
| `merge.sh` | Only merger; hourly at :30; requires `agent-reviewed`, no `needs-human`, green CI; updates branch when behind |
| `tracker.sh`, `watchdog.sh`, digest | Status, stuck-run detection, daily digest |
| Config | `factory/config.env` defaults (`${VAR:-default}`); effective overrides live in **local systemd drop-ins** `~/.config/systemd/user/factory-{dispatch,merge,digest,watchdog}.service.d/{override,path}.conf` — `ENABLE_DISPATCH=true ENABLE_MERGE=true MAX_PARALLEL=4 DAILY_SPAWN_CAP=300 DISPATCH_TIERS incl. T2 MERGE_T2=true`, PATH incl. `~/.npm-global/bin:~/.local/bin`. **Rebuild fragility:** these drop-ins are not in git. |
| Monitoring | `gh issue list --label in-progress`, `gh pr list`, `bash factory/tracker.sh`, `factory/blocked/`, `merge.systemd.log` |
| Throughput ceiling | API rate-limit backoffs |

---

## 9. Secrets — locations only

| Secret | Location | Notes |
|---|---|---|
| Factory API key | `~/.factory/env` | never in git; never paste in chat |
| Sudo phrase | `~/.config/scalar-commons/sudo.key` (0600) + operator's password manager | read only by `scripts/sudo-set-key.mjs` / `apply-upgrade.mjs` |
| Faucet seed | `~/.config/scalar-commons/faucet.env` (0600): `FAUCET_SEED`, `FAUCET_TRUST_PROXY=true`, `FAUCET_DRIP_CMN=1100` | |
| Validator session keys | node base paths under `dev`'s home | never expose `//Ferdie` or any dev seed |
| `deploy/public/domain.env` | gitignored | `DOMAIN=scalarnet.io` |
| Let's Encrypt keys | `/etc/letsencrypt/` (root) | |

Rules: agents may never read `~/.factory/env` or `~/.config/scalar-commons/*`; `gitleaks` full-history scan is a required CI check; the only allowlisted "secret-looking" strings are ss58 public addresses.

---

## 10. Standard procedures

- **Forkless runtime upgrade:** bump `spec_version`, tests green, merge, build wasm from `master`, backup to `~/upgrade-backup/<ts>/`, `node scripts/apply-upgrade.mjs` (fee preflight, sudo key funded), confirm `state_getRuntimeVersion` on public wss, all five validators authoring, keeper healthy. Documented in `deploy/upgrade.md`, `UPGRADE-305.md`, `UPGRADE-306.md`.
- **Node restart:** rolling, one at a time; then restart the three products (#155).
- **Site redeploy after landing/docs merge:** `bash deploy/public/redeploy-site.sh` (builds into temp, swaps on success).
- **Public verification:** every check in `deploy/public/VERIFY.md`; results recorded in `PUBLIC-LAUNCH.md`.
- **Economic gate run:** `cd experiments/live && node run.mjs --archetype all --eras 1` (≈1 era ≈ 6 h); result decides the landing "Testnet status" text.
- **T0 rounds** (runtime/economics): run by a Claude Code session with mechanical abort conditions instead of checkpoints (pattern used for 305 and 306).

---

## 11. Current state and open items (12 Sep 2026)

**Live and verified:** public testnet at scalarnet.io on spec 306; five URLs pass external checks; branch protection strict with 9 required checks; tester guide live at `/docs/guide/testnet-tester-guide`; chainspec + bootnodes published (outsider synced 534,612 blocks in ~10 min); PUBLIC-LAUNCH.md, TESTNETAUDIT.md in repo.

**Open issues that matter (numbers as filed):**
- #164 (T0) emission concentration — spec 305 exploit (82% of an era for 60 CMN self-dealt work); 306 deployed; **closes only when live re-measurement passes**
- #154 (T2) landing honesty — site still says spec 304 / block 433,638 / "RPC localhost-only" / GitHub links; buttons must point to `/docs/`, faucet, explorer; add testnet-status block (econ gate FAILED on 305, fix in 306, re-measurement pending; weights hand-estimated)
- #155 (T2) products don't reconnect after node ws drop
- #156 (T3) api/faucet `GET /` bare 404
- #158 (T3) auto-redeploy timer for landing/docs
- #159 (T0) validator onboarding (ValidatorCount/bonds; D11)
- #160 (T2) SDK retries deterministic dispatch errors (pays fees)
- #161 (T1) `register` never initialised LastHeartbeat (intended fix in 306 — confirm)
- #162 (T2) one faucet drip clears registration by only 4.5%
- #134 (T0) benchmarks / real weights — deferred, disclosed
- #141 (T3) ENDGOAL.md §3.3 still says four validators lack `--rpc-methods safe` (false now; text must change)
- #165 closed as duplicate of #154

**Decisions log (made by the planner, recorded in RUNBOOK / chat):** D1 rotate-not-remove sudo until mainnet · D2 `EraPayout=()` · D3 defer benchmarks with landing caveat · D4 econ gate stated honestly on site · D5 repo public · D6 strict:false only for batch day (restored) · D7 emission ≤ α × qualifying volume, lineage/ring excluded · D8 register sets LastHeartbeat · D9 pause emissions via sudo lever if one exists, else 306 · D10 landing says gate FAILED/fix in progress · D11 validators: keep 5 now, later 7 with bonds 1,000/100 · D12 `secrets`+`chainspec` required checks · D13 postpone 5-archetype run until 306 is live, then run it as 306's acceptance test.

**Regulatory / positioning notes:** CMN has no value and the testnet may reset — keep that prominent; avoid "mining" language; counsel before any token distribution or mainnet (MSB/state MTL, Reg E, SEC/CFTC; EU AI Act/MiCA/DORA since operated from Germany).

---

## 12. Documents produced outside the repo (this session's workspace)

- `SCALAR-COMMONS-v4-README.md`, `END-GOAL.md`, `RUNBOOK-AUDIT-FIX.md` (earlier deliverables)
- `scalar-commons-hours.xlsx` — 51-row hours sheet (523 h)
- `scalar-agent-threats-2026.xlsx` — 9 sheets: 2026 incidents, US gov bodies, Scalar elements, claims audit, outlook, more agencies & routes, research audit, future use, built capabilities
- `Scalar-Commons-NSA-Briefing.docx` — v8 memorandum to NSA AISC (from Matthew Rogers)
- DARPA notes: Dustin Boyer is a Commercialization Manager (SBIR/STTR transition), not a PM; PM letters follow the Heilmeier Catechism; SBIR needs a US-majority-owned small business

---

## 13. Quick verification block (run on the VPS)

```bash
cd ~/scalar-commons-v4 && git branch --show-current && git log --oneline -3
systemctl --user list-units 'scalar-*' --no-pager
systemctl --user list-timers --no-pager | grep -E 'factory|keeper|redeploy'
curl -s https://api.scalarnet.io/v1/status | head -c 300; echo
curl -s https://faucet.scalarnet.io/health; echo
curl -s -H 'Content-Type: application/json' -d '{"id":1,"jsonrpc":"2.0","method":"author_rotateKeys"}' https://rpc.scalarnet.io/; echo
sudo ufw status numbered
gh api repos/tejaspatil1936/scalar-commons-v4/branches/master/protection/required_status_checks --jq '{strict:.strict,contexts:.contexts}'
gh issue list --label in-progress; gh pr list
ls -la ~/.config/scalar-commons/ ~/.factory/env   # existence + permissions only
```
