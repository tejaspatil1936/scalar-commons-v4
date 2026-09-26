// Oracle lifecycles against a live node. Assertions are on events and storage,
// never on a submit's return value. Requires the dev accounts to be funded and
// able to register as agents (dev-real). Set SCALAR_WS to point elsewhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { blake2AsU8a } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import type { ApiPromise } from "@polkadot/api";
import { connect, devAccounts, send, hasEvent, waitBlocks } from "./helpers.js";

let api: ApiPromise;
let authoring = false;
const acc = devAccounts();
const qid = (tag: string) => u8aToHex(blake2AsU8a(`testkit:${tag}:${Date.now()}`));
const ans = (s: string) => u8aToHex(blake2AsU8a(s));

before(async () => {
  api = await connect();
  // A node that is up but not authoring blocks (stalled, or on-demand sealing
  // with a wedged pool) cannot run a lifecycle; skip rather than hang.
  const h0 = (await api.rpc.chain.getHeader()).number.toNumber();
  await new Promise((r) => setTimeout(r, 15_000));
  authoring = (await api.rpc.chain.getHeader()).number.toNumber() >= h0 + 2;
  if (!authoring) return;
  const jb = (await api.query.system.account(acc.Juror.address)) as any;
  if (jb.data.free.toBigInt() === 0n) {
    const min = (api.consts.agents.minStake as any).toBigInt();
    await send(api.tx.balances.transferKeepAlive(acc.Juror.address, min * 3n), acc.Alice);
  }
  for (const n of ["Alice", "Bob", "Charlie", "Juror"]) {
    const stake = (await api.query.agents.agentStake(acc[n].address)) as any;
    if (stake.isNone || stake.toString() === "0") {
      const min = (api.consts.agents.minStake as any).toBigInt();
      await send(api.tx.agents.register(min), acc[n]);
    }
  }
});
after(async () => api?.disconnect());

test("E7: majority is paid, dissenter scored zero (events + storage)", { timeout: 300_000 }, async (t) => {
  if (!authoring) return t.skip("node is not authoring blocks");
  const cw = (api.consts.oracle.minChallengeWindow as any).toNumber();
  // Finalise needs deadline + challenge window to elapse. On dev-real that is
  // ~600 blocks (1 h); only run where the window is compressed (dev-fast).
  if (cw > 30) return t.skip(`MinChallengeWindow=${cw} blocks; run against dev-fast`);
  const id = qid("e7");
  const bounty = (api.consts.oracle.minOracleBounty as any).toBigInt();
  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  await send(
    api.tx.oracle.createOracleRequest(id, bounty * 3n, "Factual", 3, 67, head + 6, cw, null),
    acc.Alice,
  );
  const w = ans("yes");
  await send(api.tx.oracle.submitResponse(id, w, 0), acc.Bob);
  await send(api.tx.oracle.submitResponse(id, w, 0), acc.Charlie);
  await send(api.tx.oracle.submitResponse(id, ans("no"), 0), acc.Juror);
  await waitBlocks(api, 6 + cw + 1, acc.Alice);
  const evs = await send(api.tx.oracle.finaliseRequest(id), acc.Alice);
  assert.ok(hasEvent(evs, "oracle", "OracleRequestFinalised"));
  assert.equal((await api.query.oracle.oracleResults(id)).toHex(), w);
  assert.ok(((await api.query.oracle.oracleRequests(id)) as any).isNone);
  assert.equal((await api.query.oracle.oracleScore(acc.Juror.address, 0)).toString(), "0");
  assert.equal((await api.query.oracle.oracleScore(acc.Bob.address, 0)).toString(), "10000");
});

test("E8: expireRequest returns the bounty and clears the request", { timeout: 120_000 }, async (t) => {
  if (!authoring) return t.skip("node is not authoring blocks");
  const id = qid("e8");
  const bounty = (api.consts.oracle.minOracleBounty as any).toBigInt();
  const cw = (api.consts.oracle.minChallengeWindow as any).toNumber();
  const head = (await api.rpc.chain.getHeader()).number.toNumber();
  await send(
    api.tx.oracle.createOracleRequest(id, bounty, "Factual", 3, 67, head + 2, cw, null),
    acc.Alice,
  );
  await waitBlocks(api, 3, acc.Alice);
  const evs = await send(api.tx.oracle.expireRequest(id), acc.Bob);
  assert.ok(hasEvent(evs, "oracle", "OracleRequestExpired"));
  assert.ok(((await api.query.oracle.oracleRequests(id)) as any).isNone);
});

test("E25: over-cap batch is rejected client-side/at decode, chain stays live", { timeout: 120_000 }, async (t) => {
  if (!authoring) return t.skip("node is not authoring blocks");
  const cap = (api.consts.oracle.maxBatchSubmissions as any).toNumber();
  const subs = Array.from({ length: cap + 1 }, (_, i) => [ans(`q${i}`), ans("a"), 0]);
  const before = (await api.rpc.chain.getHeader()).number.toNumber();
  await assert.rejects(async () => {
    await send(api.tx.oracle.batchSubmitResponse(subs), acc.Bob);
  });
  await waitBlocks(api, 1, acc.Alice);
  assert.ok((await api.rpc.chain.getHeader()).number.toNumber() > before);
});
