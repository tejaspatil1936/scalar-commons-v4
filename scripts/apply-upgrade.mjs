#!/usr/bin/env node
/**
 * scripts/apply-upgrade.mjs — apply a forkless runtime upgrade.
 *
 *   node scripts/apply-upgrade.mjs <path/to/runtime.compact.compressed.wasm> [--dry-run]
 *                                  [--ws ws://127.0.0.1:9944] [--expect-spec 305]
 *                                  [--ports 9944,9945,9946,9947,9948] [--blocks 20]
 *
 * Submits `sudo.sudo(system.setCode(<wasm>))` signed by the operator key in
 * ~/.config/scalar-commons/sudo.key, waits for finalization, then polls
 * state_getRuntimeVersion on every listed port until they all report the
 * expected spec_version or the block budget runs out.
 *
 * WHY THIS IS A SCRIPT AND NOT A SEQUENCE OF COMMANDS
 *
 * ENDGOAL §3.1 requires a forkless upgrade "rehearsed — spec_version bumped and
 * applied on a live network without restarting nodes", and calls a chain that
 * cannot upgrade itself "not an L1". It has never happened here: the on-chain
 * `:code` at the finalized head was byte-identical to genesis, and all five
 * previous spec bumps (300 -> 304) were compiled into fresh geneses before this
 * chain started. So this is the first one, and it needs to be repeatable and
 * auditable rather than typed once. See TESTNETAUDIT.md §6 I-20, issue #136.
 *
 * SAFETY
 *
 * - `--dry-run` prints the signer and the call hash and submits nothing.
 * - The signer is derived from the key file, never from //Alice; the file is
 *   0600 and lives outside the repository.
 * - `system.setCode` is a root call and its weight is the whole block. It goes
 *   through `sudo.sudo`, so it bypasses the normal fee/weight path by design.
 * - Success is judged by reading `state_getRuntimeVersion` back from every
 *   node, not by the extrinsic returning Ok. A blob that applies but that the
 *   other four nodes reject would still be a failed upgrade.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = ['../sdk/package.json', '../indexer/package.json'];
function loadPolkadot(pkg) {
  let lastErr;
  for (const c of CANDIDATES) {
    try {
      const req = createRequire(pathResolve(HERE, c));
      return import(pathToFileURL(req.resolve(pkg)).href);
    } catch (e) { lastErr = e; }
  }
  throw new Error(`cannot resolve ${pkg} from sdk/ or indexer/ node_modules (${lastErr && lastErr.message})`);
}
const { ApiPromise, WsProvider } = await loadPolkadot('@polkadot/api');
const { Keyring } = await loadPolkadot('@polkadot/keyring');
const { cryptoWaitReady, blake2AsHex } = await loadPolkadot('@polkadot/util-crypto');
const { u8aToHex } = await loadPolkadot('@polkadot/util');

const KEYFILE = `${homedir()}/.config/scalar-commons/sudo.key`;

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node scripts/apply-upgrade.mjs <runtime.wasm> [--dry-run] [--ws url]');
  console.error('       [--expect-spec N] [--ports a,b,c] [--blocks N]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let wasmPath = null, dryRun = false;
let ws = 'ws://127.0.0.1:9944';
let expectSpec = 305;
let ports = [9944, 9945, 9946, 9947, 9948];
let blockBudget = 20;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') dryRun = true;
  else if (a === '--ws') ws = argv[++i] || usage('--ws needs a url');
  else if (a === '--expect-spec') expectSpec = Number(argv[++i]);
  else if (a === '--ports') ports = (argv[++i] || '').split(',').map(Number).filter(Boolean);
  else if (a === '--blocks') blockBudget = Number(argv[++i]);
  else if (a.startsWith('-')) usage(`unrecognised flag: ${a}`);
  else if (wasmPath === null) wasmPath = a;
  else usage('more than one wasm path given');
}
if (!wasmPath) usage('no wasm path given');
if (!Number.isInteger(expectSpec)) usage('--expect-spec needs an integer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  await cryptoWaitReady();

  if (!existsSync(wasmPath)) usage(`wasm not found: ${wasmPath}`);
  const wasm = readFileSync(wasmPath);
  if (wasm.length === 0) usage('wasm file is empty');
  // Every Substrate runtime blob starts with the WebAssembly magic number.
  // Catching a text file or a truncated copy here is far cheaper than having
  // the chain reject it, or worse, accept something unexpected.
  const magic = wasm.subarray(0, 4);
  if (!(magic[0] === 0x00 && magic[1] === 0x61 && magic[2] === 0x73 && magic[3] === 0x6d)) {
    usage(`${wasmPath} does not start with the wasm magic number (got ${u8aToHex(magic)})`);
  }
  const wasmHash = blake2AsHex(wasm, 256);

  if (!existsSync(KEYFILE)) {
    console.error(`FATAL: operator key not found at ${KEYFILE}`);
    console.error('This upgrade is signed by the rotated sudo key, never by //Alice.');
    process.exit(1);
  }
  const mode = (statSync(KEYFILE).mode & 0o777).toString(8);
  if (mode !== '600') console.error(`WARNING: ${KEYFILE} is mode ${mode}, expected 600`);
  const phrase = readFileSync(KEYFILE, 'utf8').trim();
  if (!phrase) { console.error(`FATAL: ${KEYFILE} is empty`); process.exit(1); }

  const provider = new WsProvider(ws);
  const api = await ApiPromise.create({ provider });

  const ss58 = api.registry.chainSS58 ?? 42;
  const keyring = new Keyring({ type: 'sr25519', ss58Format: ss58 });
  const signer = keyring.addFromUri(phrase);

  const sudoKey = (await api.query.sudo.key()).toString();
  const before = api.runtimeVersion.specVersion.toNumber();

  const inner = api.tx.system.setCode(u8aToHex(wasm));
  const call = api.tx.sudo.sudo(inner);

  console.log('');
  console.log('  chain               : ' + (await api.rpc.system.chain()).toString());
  console.log('  endpoint            : ' + ws);
  console.log('  wasm                : ' + wasmPath);
  console.log('  wasm bytes          : ' + wasm.length);
  console.log('  wasm blake2-256     : ' + wasmHash);
  console.log('');
  console.log('  spec_version before : ' + before);
  console.log('  spec_version target : ' + expectSpec);
  console.log('');
  console.log('  signer              : ' + signer.address);
  console.log('  on-chain Sudo::Key  : ' + sudoKey);
  console.log('  signer is root      : ' + (signer.address === sudoKey ? 'YES' : 'NO — the call will fail'));
  console.log('');
  console.log('  call                : sudo.sudo(system.setCode(<wasm>))');
  console.log('  inner call hash     : ' + inner.method.hash.toHex());
  console.log('  outer call hash     : ' + call.method.hash.toHex());
  console.log('');

  if (signer.address !== sudoKey) {
    console.error('FATAL: the operator key does not match the on-chain root key. Refusing.');
    await api.disconnect();
    process.exit(1);
  }

  if (dryRun) {
    console.log('  DRY RUN — nothing submitted. The chain is unchanged.');
    console.log('');
    await api.disconnect();
    return;
  }

  console.log('  SUBMITTING set_code. Nodes will switch runtime WITHOUT restarting.');
  console.log('');

  const applied = await new Promise((resolve, reject) => {
    call.signAndSend(signer, ({ status, dispatchError, events }) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const d = api.registry.findMetaError(dispatchError.asModule);
          return reject(new Error(`${d.section}.${d.name}: ${d.docs.join(' ')}`));
        }
        return reject(new Error(dispatchError.toString()));
      }
      if (status.isInBlock) console.log('  in block            : ' + status.asInBlock.toHex());
      if (status.isFinalized) {
        for (const { event } of events) {
          // sudo.Sudid carries the inner call's own Result. A sudo call can be
          // finalized "successfully" while the call it wrapped failed, so this
          // is checked rather than assumed.
          if (event.section === 'sudo' && event.method === 'Sudid') {
            const r = event.data[0];
            if (r && r.isErr) return reject(new Error('sudo.Sudid reported Err: ' + r.toString()));
          }
          console.log(`  event               : ${event.section}.${event.method}`);
        }
        resolve(status.asFinalized.toHex());
      }
      if (status.isDropped || status.isInvalid || status.isUsurped) {
        reject(new Error(`transaction ${status.type}`));
      }
    }).catch(reject);
  });

  const hdr = await api.rpc.chain.getHeader(applied);
  const appliedNumber = hdr.number.toNumber();
  console.log('  finalized in        : ' + applied);
  console.log('  applied at block    : #' + appliedNumber);
  console.log('');

  // ---- poll every node -----------------------------------------------------
  // The upgrade is not done when one node says so. Ask all of them, on their
  // own RPC ports, and give up after a block budget rather than hanging.
  console.log(`  polling ports ${ports.join(', ')} for spec ${expectSpec} (budget ${blockBudget} blocks)`);
  const deadlineBlock = appliedNumber + blockBudget;
  const seen = new Map();
  let head = appliedNumber;

  while (head < deadlineBlock) {
    for (const p of ports) {
      if (seen.get(p) === expectSpec) continue;
      try {
        const res = await fetch(`http://127.0.0.1:${p}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_getRuntimeVersion', params: [] }),
        });
        const j = await res.json();
        const sv = j && j.result && j.result.specVersion;
        if (typeof sv === 'number') {
          if (seen.get(p) !== sv) console.log(`    port ${p}: specVersion ${sv}`);
          seen.set(p, sv);
        }
      } catch { /* node briefly unreachable; the budget is the timeout */ }
    }
    if (ports.every((p) => seen.get(p) === expectSpec)) break;
    await sleep(3000);
    head = (await api.rpc.chain.getHeader()).number.toNumber();
  }

  console.log('');
  const laggards = ports.filter((p) => seen.get(p) !== expectSpec);
  for (const p of ports) console.log(`  port ${p} : specVersion ${seen.get(p) ?? 'unreachable'}`);
  console.log('');

  await api.disconnect();

  if (laggards.length) {
    console.error(`FAILED — ${laggards.join(', ')} did not report spec ${expectSpec} within ${blockBudget} blocks.`);
    process.exit(1);
  }
  console.log(`  OK — all ${ports.length} nodes report specVersion ${expectSpec}.`);
  console.log(`  applied at block #${appliedNumber} (${applied})`);
  console.log(`  wasm blake2-256 ${wasmHash}`);
};

main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
