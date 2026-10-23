// Regenerates chain-facts.json from a live Scalar Commons node.
//
// Why this exists: a marketing page that hand-types "100B cap, 6h eras" drifts
// the moment a parameter moves, and nobody notices until someone quotes the
// stale number back at us. So no chain figure on the landing page is written by
// hand — every one is read out of the runtime metadata of a running node and
// committed here, with the spec version and block it was read at. The page then
// renders from this file, and `npm run verify:chain` re-checks it against the
// node.
//
// Usage:  npm run fetch:chain-facts [-- ws://127.0.0.1:9944]
import { writeFileSync } from 'node:fs';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { stringCamelCase } from '@polkadot/util';

export const DEFAULT_RPC = 'ws://127.0.0.1:9944';

// Pallets whose constants the landing page is allowed to quote. Kept explicit
// rather than dumping every pallet's consts so a new upstream FRAME pallet
// cannot silently widen what the page can claim.
const CONSTANT_PALLETS = [
  'emissions',
  'agents',
  'escrow',
  'oracle',
  'autoParams',
  'orchestrator',
  'constitution',
  // Runtime 309 added the messages pallet; its constants (fees, size caps)
  // are the home page's to quote, so it joins the list. Absent on an older
  // runtime, it is skipped like any other missing pallet.
  'messages',
  'balances',
  'babe',
  'timestamp',
];

const str = (v) => (v === null || v === undefined ? null : v.toString());

/** Reads every fact the page is allowed to state off a live node. */
export async function readChainFacts(api) {
  const header = await api.rpc.chain.getHeader();
  const properties = await api.rpc.system.properties();
  const chain = await api.rpc.system.chain();

  const constants = {};
  for (const pallet of CONSTANT_PALLETS) {
    if (!api.consts[pallet]) continue;
    constants[pallet] = Object.fromEntries(
      Object.entries(api.consts[pallet]).map(([name, value]) => [name, str(value)]),
    );
  }

  const pallets = api.registry.metadata.pallets.map((pallet) => {
    const key = stringCamelCase(pallet.name);
    return {
      name: key,
      index: pallet.index.toNumber(),
      calls: api.tx[key] ? Object.keys(api.tx[key]).sort() : [],
    };
  });

  const lastSettledEra = await api.query.emissions.lastSettledEra();
  const eraStartBlock = (await api.query.emissions.eraStartBlock()).toNumber();
  const nodeVersion = (await api.rpc.system.version()).toString();

  // The home page's readings that are counts, read whole from storage so the
  // page never types them: how many registered agents are operator-run (the
  // `swarm-` prefix on the on-chain name, as the Observatory counts it) and
  // how many agreements are in dispute right now.
  const agentEntries = await api.query.agents.agentMetadata.entries();
  const operatorRunAgents = agentEntries.filter(([, meta]) => {
    const m = meta.unwrapOr(null) ?? meta;
    const name = m?.name ? Buffer.from(m.name.toU8a(true)).toString('utf8') : '';
    return name.startsWith('swarm-');
  }).length;
  const agreementEntries = await api.query.escrow.agreements.entries();
  let openDisputes = 0;
  for (const [, list] of agreementEntries) {
    for (const agreement of list) if (agreement.status.isDisputed) openDisputes += 1;
  }

  // The last blocks, for the river the home page draws as built: number,
  // extrinsic count, and whether each was final when read.
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const finalizedNumber = (await api.rpc.chain.getHeader(finalizedHash)).number.toNumber();
  const recentBlocks = [];
  for (let n = header.number.toNumber(); n > header.number.toNumber() - 40 && n >= 0; n -= 1) {
    const hash = await api.rpc.chain.getBlockHash(n);
    const block = await api.rpc.chain.getBlock(hash);
    recentBlocks.push({ number: n, extrinsics: block.block.extrinsics.length, final: n <= finalizedNumber });
  }

  return {
    provenance: {
      source: 'live-runtime-metadata',
      note: 'Read from a running node with @polkadot/api; see scripts/fetch-chain-facts.mjs.',
      rpc: api._options?.provider?.endpoint ?? DEFAULT_RPC,
      chain: chain.toString(),
      specName: api.runtimeVersion.specName.toString(),
      specVersion: api.runtimeVersion.specVersion.toNumber(),
      metadataVersion: api.runtimeMetadata.version,
      genesisHash: api.genesisHash.toHex(),
      ss58Format: properties.ss58Format.unwrapOr(null)?.toNumber() ?? null,
      readAtBlock: header.number.toNumber(),
      readAtBlockHash: header.hash.toHex(),
      finalizedAtRead: finalizedNumber,
      nodeVersion,
      fetchedAt: new Date().toISOString(),
    },
    token: {
      symbol: properties.tokenSymbol.unwrap()[0].toString(),
      decimals: properties.tokenDecimals.unwrap()[0].toNumber(),
      plancksPerToken: (10n ** BigInt(properties.tokenDecimals.unwrap()[0].toNumber())).toString(),
    },
    constants,
    state: {
      validators: (await api.query.session.validators()).length,
      validatorCount: (await api.query.staking.validatorCount()).toNumber(),
      registeredAgents: (await api.query.agents.counterForAgentStake()).toNumber(),
      operatorRunAgents,
      openDisputes,
      eraStartBlock,
      eraElapsedBlocks: header.number.toNumber() - eraStartBlock,
      recentBlocks,
      totalIssuancePlancks: str(await api.query.balances.totalIssuance()),
      eraNumber: (await api.query.agents.eraNumber()).toNumber(),
      lastSettledEra: lastSettledEra.isEmpty ? null : str(lastSettledEra),
      alpha: (await api.query.autoParams.alpha()).toNumber(),
      beta: (await api.query.autoParams.beta()).toNumber(),
      floorBps: (await api.query.autoParams.floorBps()).toNumber(),
      completionFeeBps: (await api.query.autoParams.completionFeeBps()).toNumber(),
    },
    pallets,
  };
}

/** Connects to `endpoint`, failing loudly — an unreachable node is a finding, not a reason to guess. */
export async function connect(endpoint) {
  const provider = new WsProvider(endpoint, false);
  await provider.connect().catch((err) => {
    throw new Error(`cannot reach a Scalar Commons node at ${endpoint}: ${err.message}`);
  });
  return ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const endpoint = process.argv[2] ?? DEFAULT_RPC;
  const api = await connect(endpoint);
  const facts = await readChainFacts(api);
  await api.disconnect();

  const target = new URL('../chain-facts.json', import.meta.url);
  writeFileSync(target, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(
    `wrote chain-facts.json from ${endpoint}: ${facts.provenance.specName} spec ` +
      `${facts.provenance.specVersion}, metadata v${facts.provenance.metadataVersion}, ` +
      `block #${facts.provenance.readAtBlock}`,
  );
}
