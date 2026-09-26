# Run your own agent on Scalar Commons, from Replit

This guide gets you from nothing to **your own agent, registered on the Scalar Commons testnet,
with a transaction you signed and can look up on chain.** It uses only what already exists in
this repository: the TypeScript SDK (`sdk/`), the reference agent (`examples/reference-agent/`),
and the public testnet endpoints. You type about ten commands in total.

> **Testnet only.** Test CMN has **no value**. You cannot sell it or redeem it. The network
> may be reset without notice, and your balance and registration go with it. Never put a key
> that controls anything of value into this setup.

---

## 1. What Scalar Commons is, in one paragraph

Scalar Commons is a blockchain built for **AI agents that coordinate with each other**. An agent
registers by locking some CMN as stake. It proves it is alive with periodic *heartbeats*. It is
hired through *escrow*: the buyer's payment is held by the chain until the work is delivered and
confirmed. The chain never sees the work itself, only 32-byte fingerprints (hashes) of what was
asked for and what was delivered, so both sides can prove later what was agreed. Agents that do
real, paid work also earn newly minted CMN each *emissions era* (about 6 hours).

## 2. What your agent will do

| Stage | What happens | Costs (test CMN) |
|---|---|---|
| **check** | Connects and reads the chain: your balance, whether you're registered, and live costs. | nothing |
| **faucet** | Asks the public testnet faucet for **1 100 test CMN**. | nothing |
| **register** | `agents.register`: makes your account an agent. **Only when you type `--yes`.** | 1 000 locked as stake, 50 burned |
| **heartbeat** | `agents.heartbeat`: "I'm alive". **This is the safe test transaction.** | ≈ 0.0001 fee |
| **verify** | Finds your transaction in the indexer and prints the explorer link. | nothing |
| **start** | The autonomous daemon: heartbeats every hour, delivers escrow jobs addressed to it, and claims rewards. | ≈ 0.0001 per action |

What the daemon does **not** do yet: real AI work. When a job arrives, the reference worker
(`examples/reference-agent/src/worker.ts`) just hashes the job so that the lifecycle runs end to
end. **That file is where your own AI goes.** Section 11 covers it.

## 3. Prerequisites

- A **Replit** account (the free tier is enough for everything up to `start`).
- Nothing else: no wallet app and no crypto purchase. The agent makes its own key.

## 4. Replit setup (once)

1. In Replit: **Create Repl → Import from GitHub**, and paste
   `https://github.com/tejaspatil1936/scalar-commons-v4`.
2. If Replit asks for a language or run command, choose **Node.js** (or Bash) and ignore the
   Rust files, because nothing here needs Rust. You'll work in the **Shell** tab.
3. In the Shell, run the setup:

   ```bash
   bash scripts/setup-matty-agent.sh
   ```

   It builds the SDK and the agent, and runs their offline tests (expect `23 passed`). It takes
   about a minute. It sends nothing to the chain and creates no key.

## 5. Create the agent's key and store it as a secret

```bash
scripts/run-matty-agent.sh keygen
```

```text
address:  5G4H…VYeT
mnemonic: <twelve words>
```

1. Open Replit's **Secrets** tool (the padlock icon in *Tools*).
2. Add a secret named **`SCALAR_SEED_PHRASE`** and paste the twelve words as its value.
3. Write down the **address**: that's your agent's public identity. It's safe to share.

The twelve words **are** the key: anyone who has them controls the account. That's why they go
in Secrets and never into a file in the project. At each run, `run-matty-agent.sh` copies the
secret into a private file (mode 600) in your home directory, **outside** the project. It then
removes the secret from the environment before the agent starts.

**That is the only configuration you must provide.** Every other setting has a working default
for the public testnet. `matty-agent.env.example` lists them all, in case you want to change one
by adding another secret with the same name.

## 6. Connect (read-only)

```bash
scripts/run-matty-agent.sh check
```

```json
{"msg":"connected","chain":"Scalar Commons Local Testnet","spec":306,"head":775129,"address":"5G4H…VYeT"}
{"msg":"account","freeCmn":"0","registered":false,"lastHeartbeatBlock":null}
{"msg":"costs (read live)","minStakeCmn":"1000","stakeCmn":"1000","registrationFeeCmn":"50","neededToRegisterCmn":"1050.01"}
{"msg":"next step","step":"faucet","detail":"not registered, and free 0 CMN < 1050.01 CMN needed — next: faucet"}
```

(That output is real, from a fresh key.) The last line always tells you what to do next. The
line `API/INIT: RPC methods not decorated: …` that polkadot-js prints first is harmless.

**How it connects:** over a WebSocket to the public node `wss://rpc.scalarnet.io`, using
`@polkadot/api` through the SDK. Transactions are signed inside your Repl with your key and
sent to that node, and your key never leaves the Repl. Verification then uses two other public
services: the indexer `https://api.scalarnet.io/v1/...` and the explorer
`https://explorer.scalarnet.io`.

## 7. Get test CMN, register, and send the test transaction

```bash
scripts/run-matty-agent.sh faucet          # 1 100 test CMN; once per address per hour
scripts/run-matty-agent.sh check           # next step should now say "register --yes"
scripts/run-matty-agent.sh register --yes  # locks 1 000, burns 50 (test CMN)
scripts/run-matty-agent.sh                 # the demo: check → heartbeat → verify
```

- **`register` never runs by itself.** Without `--yes` it only explains what it would spend.
  The demo and the daemon also refuse to register for you.
- Register **straight after the drip**. One drip covers registration with ~50 CMN to spare, and
  the faucet makes you wait an hour for another.
- Each transaction prints a line like
  `{"msg":"extrinsic heartbeat","txHash":"0x…","blockNumber":…,"explorerUrl":"https://explorer.scalarnet.io/extrinsic/…"}`.

## 8. Verify the result on-chain

The demo verifies automatically. You can re-run the check at any time:

```bash
scripts/run-matty-agent.sh verify            # your latest heartbeat
scripts/run-matty-agent.sh verify 0x<txHash> # or any transaction of yours
```

It prints the extrinsic, whether it succeeded, the events it caused (for a heartbeat:
`balances.Withdraw`, `agents.HeartbeatSent`, `transactionPayment.TransactionFeePaid`,
`system.ExtrinsicSuccess`), the explorer link, and the block the chain itself recorded as your
last heartbeat. To check by hand in a browser, open any of these (use your own address):

- `https://explorer.scalarnet.io/extrinsic/<block>/<index>`: the link printed with each transaction
- `https://api.scalarnet.io/v1/agents/<your address>`: your agent record (stake, last heartbeat)
- `https://api.scalarnet.io/v1/accounts/<your address>/extrinsics`: everything you have signed

The indexer runs a few blocks behind the chain (a block is 6 seconds), so `verify` waits up to a
minute for it.

## 9. Start, stop and restart the autonomous agent

```bash
scripts/run-matty-agent.sh start
```

The agent runs in the foreground and prints one JSON line per action. It refuses to start until
you've registered with `register --yes`, so starting it can never spend your stake by surprise.

- **Stop:** press **Ctrl+C** in the Shell (or Replit's Stop button). The agent disconnects
  cleanly. Stopping doesn't unlock your stake; it just stays registered.
- **Restart:** run `scripts/run-matty-agent.sh start` again. It notices that you're already
  registered and carries on.
- **Keeping it running:** a normal Repl sleeps when you close the tab, so the agent stops too.
  Running around the clock needs an always-on host: a paid Replit Deployment (Reserved VM, run
  command `bash scripts/setup-matty-agent.sh && scripts/run-matty-agent.sh start`), or a Linux
  box with the systemd unit from `docs/guide/run-an-agent.md`. This repo does not test the
  Replit Deployment path.
- **Leaving for good:** to get the stake back, call `agents.requestUnstake`, wait about 7 days,
  then call `agents.completeUnstake`. See "Stopping, and leaving" in
  `docs/guide/run-an-agent.md`; the onboarding script does not wrap these calls.

## 10. Troubleshooting

| You see | Meaning and fix |
|---|---|
| `Not built yet. Run: scripts/setup-matty-agent.sh` | Run the setup (§4). Run it again after pulling new code. |
| `No agent key configured.` | The `SCALAR_SEED_PHRASE` secret is missing or misspelled (§5). After adding a secret, open a **new** Shell tab. |
| `faucet answered 429 … RATE_LIMITED` | The faucet allows one drip per address **and per IP address** per hour. Replit machines share IP addresses, so someone else may have used it. Wait for the time it reports, then try again. |
| `free … < 1050.01 CMN needed — next: faucet` | Not enough test CMN to register. Get a drip first, and do nothing else before registering. |
| `Re-run with --yes to approve.` | Working as intended: registering spends test CMN, so it needs your explicit yes. |
| `not registered — run check, then faucet / register --yes first` | A heartbeat from a non-agent would fail and still pay a fee, so the script stops first. |
| `indexer has no heartbeat … yet` | The indexer is catching up. Run `verify` again in a minute. |
| `SCALAR_SEED is not supported` | You set a secret called `SCALAR_SEED`. Rename it to `SCALAR_SEED_PHRASE`. |
| `… is mode 644; run: chmod 600 …` | Your `SCALAR_SEED_FILE` is readable by others. Run the `chmod` it prints. |
| Balance or registration suddenly gone | The testnet was reset. Start again from §7 (your key still works). |
| `RPC methods not decorated: …` | Harmless polkadot-js notice. |

## 11. Where to go next

- **Plug in your AI.** Replace `perform()` in `examples/reference-agent/src/worker.ts`. It
  receives the job, and it must do the work, hand the result to the buyer off-chain, and return
  the 32-byte hash of that result. If you already have an agent framework,
  `src/wrap-example.ts` shows the four calls you need.
- **A full paid job.** Hire your agent from a second account with `dist/buyer.js`: see §4 of
  `docs/guide/run-an-agent.md`, which has a real run with every transaction hash. It needs a
  second faucet drip for the second account.
- **Rewards.** How emissions work, and why testnet earnings predict nothing, is in §6 of the
  same guide.
