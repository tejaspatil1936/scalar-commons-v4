# @scalar-commons/sdk

TypeScript agent SDK for the **Scalar Commons** chain — the agent-facing surface
described in protocol §8.3 ("archetypes cannot exist without hands"). Built on
[`@polkadot/api`](https://github.com/polkadot-js/api).

> **Skeleton (P0-3).** This is the initial method surface: register/stake/heartbeat,
> the escrow lifecycle, oracle submission, governance voting, era settlement, and
> emission claims, plus read helpers.

## Install & build

```bash
cd sdk
npm ci
npm run build      # tsc -> dist/
npm run typecheck  # tsc --noEmit
npm test           # vitest — mock-driven, no node required
```

`npm test` is mock-driven and needs no node. The live checks against a real
devnet are opt-in — see [Integration tests against a real node](#integration-tests-against-a-real-node).

## Design rules

- **polkadot-js only** for transport.
- **No silent retries.** Every retry is logged with its attempt number and the
  triggering error (`src/retry.ts`); the final give-up logs at `error` and rethrows.
- **Balances are `bigint` plancks** (1 CMN = 10¹² plancks).

## Usage

```ts
import { ScalarCommonsClient, PLANCKS_PER_CMN } from '@scalar-commons/sdk';
import { Keyring } from '@polkadot/keyring';

const client = await ScalarCommonsClient.connect('ws://127.0.0.1:9944');
const alice = new Keyring({ type: 'sr25519' }).addFromUri('//Alice');

await client.register(alice, 100n * PLANCKS_PER_CMN);
await client.heartbeat(alice);

const pos = await client.netPosition(alice.address);
console.log(pos.stake, pos.pendingEmissions);

await client.disconnect();
```

## Method → chain mapping

| SDK method | Extrinsic / query |
|---|---|
| `register(signer, stake)` | `agents.register(stake)` |
| `stake(signer, amount)` | `agents.addStake(amount)` |
| `heartbeat(signer)` | `agents.heartbeat()` |
| `createEscrow(signer, provider, amount, hash, deliverBy, cap?)` | `escrow.createAgreement(...)` |
| `acceptEscrow(signer, buyer, seq, hash)` | `escrow.recordDelivery(...)` |
| `completeEscrow(signer, provider, seq)` | `escrow.confirmDelivery(...)` |
| `submitOracle(signer, requestId, answerHash, capability)` | `oracle.submitResponse(...)` |
| `vote(signer, pollIndex, vote)` | `convictionVoting.vote(...)` |
| `recordGovVote(signer, pollIndex)` | `agents.recordGovVote(signerAddress, pollIndex)` |
| `settleEra(signer)` | `emissions.settleEra()` |
| `claim(signer)` | `emissions.claim()` |
| `eraInfo()` | `agents.eraNumber` + `emissions.*` + `EraDuration` const |
| `weightOf(addr)` | `emissions.agentWeightSnapshot(addr)` |
| `totalIssuance()` | `balances.totalIssuance` |
| `netPosition(addr)` | `system.account` + `agents.agentStake/eraEscrowVolume` + pending calc |

### Reading the chain honestly

Two shapes bite anyone who assumes them instead of reading the metadata:

- `emissions.lastSettledEra` is an `Option<u32>`. `EraInfo.lastSettledEra` is
  therefore `number | null` — `null` (nothing has ever settled) is not era `0`.
- Agent stake is a **lock** (`Currency::set_lock`), so it lives *inside*
  `system.account.data.free` and shows up as `frozen`. `NetPosition` reports
  `free`, `reserved`, `frozen` and a `total` of `free + pendingEmissions` —
  adding `stake` on top would report tokens that were never issued. It reports
  no "transferable" figure: what a transfer can move also depends on the
  existential deposit, and an advisory number that ignores it is worse than none.

Since `record_gov_vote` is self-only on chain, `recordGovVote` derives the
`agent` argument from `signer`; passing any other account earns `Unauthorized`
— which the live suite proves by submitting exactly that mismatched call.

## Integration tests against a real node

`tests/live.test.ts` asserts, against the node's own metadata: the runtime spec
version, that `agents.recordGovVote` takes `(agent, pollIndex)`, that
`emissions.lastSettledEra` is `Option<u32>`, that `balances.totalIssuance` is a
`u128`, and that `netPosition` does not double-count the stake lock. It also
submits two real `recordGovVote` calls — one that the runtime must reject on a
*guard* (`NotActivelyVoting`), proof the call encoded with the right arity that
a stale signature could not manage, and one with `agent != signer` that must be
rejected with `Unauthorized`, proof of the self-only rule the docs claim.

It is opt-in, so `npm test` stays node-free. When enabled it **fails rather than
skips** if the node is unreachable — an SDK that cannot be checked against the
chain it wraps is a finding, not a pass:

```bash
RUN_INTEGRATION=1 WS_ENDPOINT=ws://127.0.0.1:9944 npm run test:integration
```
