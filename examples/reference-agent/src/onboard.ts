#!/usr/bin/env node
/**
 * scalar-onboard — first contact with Scalar Commons, one step at a time.
 *
 *   scalar-onboard keygen            print a NEW mnemonic + address (writes nothing, sends nothing)
 *   scalar-onboard check             read-only: chain, balance, registration, costs, next step
 *   scalar-onboard faucet            ask the public testnet faucet for one drip to this address
 *   scalar-onboard register --yes    agents.register — locks the stake, burns the registration fee
 *   scalar-onboard heartbeat         agents.heartbeat — the safe test transaction (fee only)
 *   scalar-onboard verify [txHash]   find the extrinsic and its events in the indexer, plus chain state
 *   scalar-onboard demo              check → heartbeat → verify, if registered; otherwise the next step
 *
 * Same environment as the daemon (SCALAR_WS, SCALAR_SEED_FILE, AGENT_STAKE_CMN,
 * EXPLORER_BASE) plus SCALAR_INDEXER and SCALAR_FAUCET. Nothing here spends
 * without an explicit command: `register` refuses to run without `--yes`, and
 * `demo` never registers.
 */
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';
import { loadConfig } from './config.js';
import { ScalarAgentAdapter, loadSigner, type TxRecord } from './adapter.js';
import { findTx, formatCmn, nextStep, registrationNeed, type IndexedExtrinsic } from './onboard-plan.js';
import { log } from './log.js';

const env = (name: string, dflt: string) => (process.env[name]?.trim() || dflt).replace(/\/+$/, '');
const INDEXER = env('SCALAR_INDEXER', 'https://api.scalarnet.io');
const FAUCET = env('SCALAR_FAUCET', 'https://faucet.scalarnet.io');

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function keygen(): Promise<void> {
  await cryptoWaitReady();
  const mnemonic = mnemonicGenerate(12);
  const pair = new Keyring({ type: 'sr25519', ss58Format: 42 }).addFromUri(mnemonic);
  // Deliberately plain text, not a JSON log line: this is the one moment a human copies the phrase.
  console.log(`address:  ${pair.address}`);
  console.log(`mnemonic: ${mnemonic}`);
  console.log('Store the mnemonic as a secret (Replit: Secrets → SCALAR_SEED_PHRASE). It is not saved anywhere.');
  console.log('Anyone with it controls this account. Use it for the testnet only.');
}

async function status(chain: ScalarAgentAdapter, stakePlancks: bigint) {
  const c = chain.api.consts;
  const need = registrationNeed({
    stake: stakePlancks,
    registrationFee: BigInt(c.agents!.baseRegistrationFee!.toString()),
    existentialDeposit: BigInt(c.balances!.existentialDeposit!.toString()),
  });
  const registered = await chain.isRegistered();
  const free = await chain.freeBalance();
  return { registered, free, need, ...nextStep({ registered, free, need }) };
}

async function check(chain: ScalarAgentAdapter, stakePlancks: bigint) {
  const s = await status(chain, stakePlancks);
  const c = chain.api.consts;
  log('info', 'connected', {
    chain: (await chain.api.rpc.system.chain()).toString(),
    spec: chain.api.runtimeVersion.specVersion.toNumber(),
    head: await chain.head(),
    address: chain.address,
  });
  log('info', 'account', {
    freeCmn: formatCmn(s.free),
    registered: s.registered,
    lastHeartbeatBlock: s.registered ? await chain.lastHeartbeat() : null,
  });
  log('info', 'costs (read live)', {
    minStakeCmn: formatCmn(BigInt(c.agents!.minStake!.toString())),
    stakeCmn: formatCmn(stakePlancks),
    registrationFeeCmn: formatCmn(BigInt(c.agents!.baseRegistrationFee!.toString())),
    neededToRegisterCmn: formatCmn(s.need),
  });
  log('info', 'next step', { step: s.step, detail: s.message });
  return s;
}

async function faucet(address: string): Promise<void> {
  const res = await fetch(`${FAUCET}/drip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`faucet answered ${res.status}: ${JSON.stringify(body)}`);
  log('info', 'faucet drip', { ...(body as object) });
}

async function register(chain: ScalarAgentAdapter, stakePlancks: bigint, confirmed: boolean): Promise<void> {
  const s = await status(chain, stakePlancks);
  if (s.registered) {
    log('info', 'already registered', { address: chain.address });
    return;
  }
  if (s.free < s.need) throw new Error(s.message);
  if (!confirmed) {
    const fee = BigInt(chain.api.consts.agents!.baseRegistrationFee!.toString());
    throw new Error(
      `register locks ${formatCmn(stakePlancks)} test CMN as stake and burns the ${formatCmn(fee)} test CMN ` +
        `registration fee. Re-run with --yes to approve.`,
    );
  }
  log('info', 'extrinsic register', { ...(await chain.register(stakePlancks)), stake: stakePlancks });
}

async function heartbeat(chain: ScalarAgentAdapter): Promise<TxRecord> {
  if (!(await chain.isRegistered())) {
    // agents.heartbeat fails with NotRegistered and still pays the fee.
    throw new Error('not registered — run check, then faucet / register --yes first');
  }
  const tx = await chain.heartbeat();
  log('info', 'extrinsic heartbeat', { ...tx });
  return tx;
}

async function verify(chain: ScalarAgentAdapter, txHash: string | undefined): Promise<void> {
  const page = `${INDEXER}/v1/accounts/${chain.address}/extrinsics?limit=25`;
  let found: IndexedExtrinsic | undefined;
  // The indexer follows the chain a few blocks behind; give it up to a minute.
  for (let i = 0; i < 12 && !found; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5_000));
    const { status: code, body } = await getJson(page);
    if (code !== 200) throw new Error(`indexer ${page} answered ${code}`);
    const items = (body as { items?: IndexedExtrinsic[] }).items ?? [];
    found = txHash ? findTx(items, txHash) : items.find((x) => x.section === 'agents' && x.method === 'heartbeat');
  }
  if (!found) throw new Error(`indexer has no ${txHash ? `extrinsic ${txHash}` : 'heartbeat'} for ${chain.address} yet — try verify again shortly`);

  const { body: ev } = await getJson(`${INDEXER}/v1/extrinsics/${found.id}/events`);
  const events = ((ev as { items?: { section: string; method: string }[] })?.items ?? []).map((e) => `${e.section}.${e.method}`);
  const [block, index] = found.id.split('-');
  log('info', 'verified on chain', {
    extrinsic: `${found.section}.${found.method}`,
    id: found.id,
    hash: found.hash,
    success: found.success,
    events,
    explorerUrl: `${(process.env.EXPLORER_BASE?.trim() || 'https://explorer.scalarnet.io').replace(/\/+$/, '')}/extrinsic/${block}/${index}`,
    indexerUrl: `${INDEXER}/v1/extrinsics/${found.id}`,
    chainLastHeartbeatBlock: await chain.lastHeartbeat(),
  });
}

async function main(): Promise<void> {
  const [cmd = 'demo', ...args] = process.argv.slice(2);
  if (cmd === 'keygen') return keygen();

  const cfg = loadConfig(process.env);
  const chain = await ScalarAgentAdapter.connect(cfg.wsUrl, await loadSigner(cfg.seedFile), cfg.explorerBase);
  try {
    if (cmd === 'check') {
      const s = await check(chain, cfg.stakePlancks);
      // --require-registered: used by run-matty-agent.sh before starting the daemon,
      // because the daemon registers on its own and that spend must be approved first.
      if (args.includes('--require-registered') && !s.registered) process.exitCode = 3;
    } else if (cmd === 'faucet') {
      await faucet(chain.address);
    } else if (cmd === 'register') {
      await register(chain, cfg.stakePlancks, args.includes('--yes'));
    } else if (cmd === 'heartbeat') {
      await heartbeat(chain);
    } else if (cmd === 'verify') {
      await verify(chain, args[0]);
    } else if (cmd === 'demo') {
      const s = await check(chain, cfg.stakePlancks);
      if (s.step === 'heartbeat') {
        const tx = await heartbeat(chain);
        await verify(chain, tx.txHash);
      }
    } else {
      throw new Error('commands: keygen | check | faucet | register --yes | heartbeat | verify [txHash] | demo');
    }
  } finally {
    await chain.disconnect();
  }
}

main().catch((e: unknown) => {
  log('error', 'fatal', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
