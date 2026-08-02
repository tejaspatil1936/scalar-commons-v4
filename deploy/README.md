# Scalar Commons — persistent 3-validator devnet

A 3-validator Scalar Commons network that runs 24/7 on this VPS under **user**
systemd (no root, no system units). `loginctl enable-linger dev` is already set,
which is what lets the user manager start at boot with nobody logged in — that
is the mechanism by which this survives a reboot.

Everything here is ops and configuration. No pallet, runtime, or node source is
involved.

---

## Layout

| node    | p2p   | RPC                 | prometheus       | base path                 | pruning |
|---------|-------|---------------------|------------------|---------------------------|---------|
| alice   | 30333 | 9944 (127.0.0.1)    | 9615 (127.0.0.1) | `~/scalar-testnet/alice`  | archive |
| bob     | 30334 | 9945 (127.0.0.1)    | 9616 (127.0.0.1) | `~/scalar-testnet/bob`    | default |
| charlie | 30335 | 9946 (127.0.0.1)    | 9617 (127.0.0.1) | `~/scalar-testnet/charlie`| default |

- **alice is the bootnode and the query endpoint.** Her peer id is pinned by a
  fixed node key, so the multiaddr baked into bob's and charlie's units stays
  valid forever:
  `/ip4/127.0.0.1/tcp/30333/p2p/12D3KooWEyoppNCUx8Yx66oV9fJnriXwCcXwDDUA2kj6vnc6iDEp`
- **bob and charlie are given only alice as a bootnode.** They find each other
  through authority discovery over the DHT (ROUND5), never through config.
- alice runs `archive` pruning because she is the endpoint the indexer would
  query and needs full history. bob and charlie use default pruning to save disk.

Files:

```
deploy/
├── README.md                   this file
├── scalar-local-raw.json       committed raw chainspec (the network's identity)
├── build-spec.sh               regenerate that chainspec
├── install.sh                  create base paths + node keys, install & enable units
├── snapshot.sh                 consistent state snapshot of one node
├── reset-chain.sh              DESTRUCTIVE wipe back to genesis
└── systemd/
    ├── scalar-alice.service
    ├── scalar-bob.service
    ├── scalar-charlie.service
    └── scalar-devnet.target    starts/stops all three together
```

---

## Install and start

```bash
cargo build --release -p scalar-node     # if the binary is not current
./deploy/build-spec.sh                   # only needed if the spec is missing
./deploy/install.sh                      # base paths, node keys, units, enable
systemctl --user start scalar-devnet.target
```

`install.sh` is idempotent and never deletes chain data.

---

## Status

```bash
# all three at a glance
systemctl --user status scalar-alice scalar-bob scalar-charlie --no-pager

# just the up/down state
systemctl --user is-active scalar-alice scalar-bob scalar-charlie

# confirm they are enabled — i.e. they come back after a reboot
systemctl --user is-enabled scalar-devnet.target scalar-alice scalar-bob scalar-charlie

# current height and finality, straight from alice's RPC
curl -sH 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"system_syncState","params":[]}' \
     http://127.0.0.1:9944

curl -sH 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"chain_getFinalizedHead","params":[]}' \
     http://127.0.0.1:9944

# peer count
curl -sH 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
     http://127.0.0.1:9944
```

## Logs

All three log to journald.

```bash
journalctl --user -u scalar-alice -f                 # follow one node
journalctl --user -u scalar-alice -n 100 --no-pager  # last 100 lines
journalctl --user -u scalar-alice --since '10 min ago' --no-pager

# all three interleaved
journalctl --user -u scalar-alice -u scalar-bob -u scalar-charlie -f

# just the heartbeat lines (best / finalized height)
journalctl --user -u scalar-alice --since '5 min ago' --no-pager | grep Idle
```

## Stop / start / restart

```bash
systemctl --user restart scalar-bob            # one node
systemctl --user stop    scalar-devnet.target  # all three
systemctl --user start   scalar-devnet.target
systemctl --user restart scalar-devnet.target
```

The services declare `PartOf=scalar-devnet.target`, so target-level stop and
restart move all three together.

To stop the devnet coming back after a reboot:

```bash
systemctl --user disable scalar-devnet.target scalar-alice scalar-bob scalar-charlie
```

---

## Firewall — the commands **you** need to run as root

I cannot run these; they need sudo. Nothing below is required for the devnet to
*work* — all three nodes talk to each other over loopback, so the network
finalizes with every port closed. These only matter if you want peers or clients
from outside this box.

**Current state: `ufw` is installed and its unit is enabled, but the service is
inactive — there is no host packet filtering running right now.**

> [!WARNING]
> `ufw enable` applies a **default-deny on incoming** policy. If you enable it
> without allowing SSH first, you will lock yourself out of this VPS. SSH is on
> port 22. Run the SSH rule first, in the order below.

### Open p2p so external validators / full nodes can join

```bash
sudo ufw allow 22/tcp                comment 'ssh — MUST be first'
sudo ufw allow 30333:30335/tcp       comment 'scalar commons devnet p2p'
sudo ufw enable
sudo ufw status verbose
```

### Public RPC (optional — read the next section first)

```bash
sudo ufw allow 9944/tcp              comment 'scalar commons RPC (public)'
```

Prefer restricting it to your own address rather than the whole internet:

```bash
sudo ufw allow from <YOUR.IP.ADDR> to any port 9944 proto tcp comment 'scalar RPC'
```

To undo any of these:

```bash
sudo ufw status numbered
sudo ufw delete <number>
```

---

## Public RPC — deliberately not enabled yet

**alice's RPC binds to `127.0.0.1:9944`, not `0.0.0.0`.** The unit does *not*
pass `--rpc-external`. This is intentional and is a deviation from the literal
flag list in the ROUND10 brief, which asked for `--rpc-external` *and* for the
endpoint to be on `127.0.0.1` "not by binding to 0.0.0.0 yet" — those two are
mutually exclusive. `--rpc-external`'s own help text reads "Listen to all RPC
interfaces (default: local)".

I resolved it toward the stated intent (localhost) because ufw is currently
inactive: binding `0.0.0.0` right now would put a JSON-RPC endpoint on a public
IP with **no packet filter in front of it at all**. `--rpc-methods safe` is set
either way, but "safe" still exposes chain state, tx submission, and enough
surface that it should not go up unfiltered by accident.

**You do not need to open the port to use the RPC remotely.** An SSH tunnel is
the better answer and needs no firewall change and no unit edit:

```bash
# from your laptop
ssh -L 9944:127.0.0.1:9944 dev@152.53.113.104
# then point any client at ws://127.0.0.1:9944 or http://127.0.0.1:9944
# e.g. https://polkadot.js.org/apps/?rpc=ws%3A%2F%2F127.0.0.1%3A9944
```

If you genuinely want it bound publicly, do it in this order:

1. Put the firewall up first (`sudo ufw allow 22/tcp && sudo ufw enable`), and
   ideally restrict 9944 to your own IP as shown above.
2. Add `--rpc-external \` to `ExecStart` in
   `deploy/systemd/scalar-alice.service` (keep `--rpc-methods safe`).
3. Reinstall and restart:
   ```bash
   ./deploy/install.sh
   systemctl --user restart scalar-alice
   ```
4. Verify what it is actually bound to:
   ```bash
   ss -ltnp | grep 9944
   ```

For anything beyond a testnet, terminate TLS and rate-limit at a reverse proxy
rather than exposing the node's own port.

---

## Snapshots

```bash
./deploy/snapshot.sh            # alice (default)
./deploy/snapshot.sh charlie
```

Writes `~/scalar-snapshots/<node>-<UTC timestamp>.tar.zst`.

The script **stops the node, copies, and starts it again**. A tar of a running
node's database can be torn — the DB holds an exclusive lock and buffers writes
in memory — so a hot copy is not a supportable backup.

Restore:

```bash
systemctl --user stop scalar-alice
rm -rf ~/scalar-testnet/alice
tar -C ~/scalar-testnet -xf ~/scalar-snapshots/alice-<stamp>.tar.zst
systemctl --user start scalar-alice
```

---

## Fault tolerance — read before you take a node down

**This 3-validator set tolerates zero failures for finality.** GRANDPA's
supermajority threshold for `n` authorities is `n - (n-1)/3`, which for `n = 3`
is `3` — every authority must vote. Stopping any one node **pauses
finalization** until it rejoins. Block *production* continues (BABE only needs a
slot leader), so `best` keeps climbing while `finalized` sits still.

Measured on this box — charlie stopped for 35s, alice and bob sampled:

```
21:19:44Z steady     | alice 48/46 | bob 48/46
--- STOPPING CHARLIE (2 of 3 authorities remain) ---
21:19:50Z down+10s   | alice 49/46 | bob 49/46
21:20:00Z down+20s   | alice 50/46 | bob 50/46
21:20:15Z down+35s   | alice 52/46 | bob 52/46     <- best +4, finalized frozen
--- STARTING CHARLIE ---
21:20:20Z up+5s      | alice 53/46 | bob 53/46
21:20:25Z up+10s     | alice 54/52 | bob 54/52     <- finality catches up in one step
```

Production advanced 48 → 52 while finality sat at 46 for the entire outage, then
jumped 46 → 52 within ~10s of charlie returning. No manual intervention.

This is inherent to a 3-authority set, not a defect, and it is why snapshots and
restarts should be treated as maintenance windows. A network that must tolerate
one validator being down needs **at least 4** authorities (`n = 4` → threshold
`4 - 1 = 3`).

---

## Resetting the chain

```bash
./deploy/reset-chain.sh     # prompts for confirmation
```

Needed after regenerating the chainspec: a new genesis hash is a new chain and
the existing databases are not compatible with it. Node keys are preserved, so
alice's bootnode multiaddr does not change.

---

## What mainnet needs that this testnet skips

This devnet is **not a template for mainnet.** It is deliberately insecure in
ways that are fine for a local testnet and disqualifying for anything holding
value:

- **Session keys are the well-known `//Alice`, `//Bob`, `//Charlie` seeds.**
  Every one of those private keys is public knowledge and in every Substrate
  test fixture on earth. Anyone can author and sign as these validators. Mainnet
  needs keys generated per validator (`scalar-node key generate-session-keys`),
  held in each validator's own keystore, and registered on chain via
  `session.setKeys` — never derived from a seed that appears in a repo.
- **Node keys are `0x00…01/02/03`.** Real ones come from
  `scalar-node key generate-node-key --file <path>`, are 0600, and are backed up
  — losing one changes a bootnode's peer id.
- **`sudo` is a single Alice key** (`chain_spec.rs`: "replaced by multisig in
  staging/mainnet"). Mainnet needs the multisig, and the documented day-14
  referendum handoff that removes sudo entirely.
- **One host.** Three validators sharing a box, a kernel, a disk, and a power
  supply is one fault domain, not three. Real validators are on separate
  machines in separate locations.
- **Three authorities means zero fault tolerance** for finality — see above.
  Mainnet needs enough validators that losing several is survivable.
- **SS58 prefix is 42**, the generic Substrate default. `chain_spec.rs` already
  flags this: `// MAINNET BLOCKER: register unique SS58 prefix`.
- **`ChainType::Local`** and a chainspec with no telemetry endpoints and no
  public bootnodes.
- **No TLS, no reverse proxy, no rate limiting, no monitoring/alerting.**
  Prometheus is exported on 127.0.0.1 but nothing scrapes it and nothing pages
  anyone when finality stalls.
- **No key backup, no disaster recovery, no runbook** beyond this file.
