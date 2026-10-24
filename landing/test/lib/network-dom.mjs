// A browser for /network's script in the test runner: the page rendered from
// chain-facts.json in jsdom, a fake node behind a fake WebSocket and a fake
// indexer behind fetch, both answering from small fixtures. `boot` imports
// src/network/main.js against them and returns the document. Timers are
// unref'd so the script's 12 s loop never holds the test process open.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderNetwork } from '../../src/network.mjs';
import { storageKey, bytesToHex } from '../../src/observatory/scale.js';
import { encodeSs58 } from '../../src/observatory/ss58.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
export const facts = readJson('../../chain-facts.json');

const key = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : (i * 7) % 256));
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const u32 = (n) => `0x${[0, 1, 2, 3].map((i) => ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')).join('')}`;
const u128 = (v) => {
  let x = BigInt(v);
  let out = '0x';
  for (let i = 0; i < 16; i += 1) {
    out += (x & 0xffn).toString(16).padStart(2, '0');
    x >>= 8n;
  }
  return out;
};
const hashOf = (n) => `0x${n.toString(16).padStart(64, '0')}`;
// A secondary-plain BABE pre-digest naming an authority index.
const predigest = (index) => `0x064241424534${'02'}${index.toString(16).padStart(2, '0')}0000002f4acf1100000000`;

export const FIX = {
  best: 100,
  finalized: 98,
  stashes: [key(1), key(2)],
  babe: [key(11), key(12)],
  seats: 3,
  era: 7,
  eraStart: 50,
  agents: 3,
  agreements: 5,
};
FIX.addresses = FIX.stashes.map((k) => encodeSs58(k, facts.provenance.ss58Format));

const STORAGE = {
  [storageKey('Session', 'Validators')]: bytesToHex(cat([0x08], ...FIX.stashes)),
  [storageKey('Session', 'QueuedKeys')]: bytesToHex(cat([0x08], FIX.stashes[0], FIX.babe[0], key(21), key(31), FIX.stashes[1], FIX.babe[1], key(22), key(32))),
  [storageKey('Babe', 'Authorities')]: bytesToHex(cat([0x08], FIX.babe[0], [1, 0, 0, 0, 0, 0, 0, 0], FIX.babe[1], [1, 0, 0, 0, 0, 0, 0, 0])),
  [storageKey('Staking', 'ValidatorCount')]: u32(FIX.seats),
  [storageKey('Agents', 'EraNumber')]: u32(FIX.era),
  [storageKey('Emissions', 'EraStartBlock')]: u32(FIX.eraStart),
  [storageKey('Emissions', 'LastSettledEra')]: u32(FIX.era - 1),
  [storageKey('Emissions', 'LastEraEmission')]: u128('2500000000000000'),
  [storageKey('Balances', 'TotalIssuance')]: u128('18000000000000000000000'),
  [storageKey('Agents', 'CounterForAgentStake')]: u32(FIX.agents),
  [storageKey('Escrow', 'ActiveAgreementCount')]: u32(FIX.agreements),
  [storageKey('AutoParams', 'CompletionFeeBps')]: u32(25),
};
const header = (n) => ({ number: `0x${n.toString(16)}`, parentHash: hashOf(n - 1), digest: { logs: [predigest(n % 2)] } });

/** Storage keys the fake node answers null for, as a node does for an absent item (see `boot`). */
let ABSENT = new Set();

function rpcAnswer(method, params) {
  switch (method) {
    case 'chain_getHeader':
      return header(params?.[0] ? Number.parseInt(params[0], 16) : FIX.best);
    case 'chain_getFinalizedHead':
      return hashOf(FIX.finalized);
    case 'chain_getBlockHash':
      return hashOf(params[0]);
    case 'chain_getBlock':
      return { block: { header: header(Number.parseInt(params[0], 16)), extrinsics: ['0x280501000b90ad5a6aa101', '0x00'] } };
    case 'state_getStorage':
      return ABSENT.has(params[0]) ? null : (STORAGE[params[0]] ?? null);
    default:
      return null;
  }
}

export function indexerAnswer(path, now) {
  const [a, b] = FIX.addresses;
  if (path.startsWith('/v1/activity')) return { total: 1, items: [{ id: '99-1', blockNumber: 99, timestampMs: now - 5_000, kind: 'dispute', section: 'escrow', method: 'DisputeOpened', agents: [a, b], data: { buyer: a, provider: b, seq: 3 } }], historyFrom: 1 };
  if (path.startsWith('/v1/agents')) return { total: 3, items: [
    { address: a, registeredAtBlock: 10, lastHeartbeatBlock: 95, unstakeAtBlock: null, metadata: { name: 'swarm-0001' } },
    { address: b, registeredAtBlock: 30, lastHeartbeatBlock: 1, unstakeAtBlock: null, metadata: null },
    { address: a.replace(/.$/, 'x'), registeredAtBlock: 20, lastHeartbeatBlock: 90, unstakeAtBlock: 400, metadata: { name: 'keith' } },
  ] };
  if (path.startsWith('/v1/escrows')) return { total: 1, items: [{ status: 'Disputed', buyer: a, provider: b }], truncated: false };
  if (path.includes('MessageSent')) return { total: 42, items: [] };
  if (path.includes('SlashExecuted')) return { total: 2, items: [{ blockNumber: 95 }, { blockNumber: 3 }] };
  return null;
}

/**
 * Renders the page, wires the fakes and imports the script. `fail` makes both the node and the indexer
 * unreachable; `absent` lists storage keys the node answers null for.
 */
export async function boot({ fail = false, absent = [] } = {}) {
  ABSENT = new Set(absent);
  const html = renderNetwork({ facts, history: readJson('../../runtime-history.json'), status: readJson('../../public/status.json'), posture: readJson('../../public/posture.json'), css: '', builtAt: facts.provenance.fetchedAt });
  const dom = new JSDOM(html, { url: 'https://scalarnet.io/network', pretendToBeVisual: true });
  const realTimeout = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const t = realTimeout(fn, ms, ...rest);
    t.unref?.();
    return t;
  };
  globalThis.setInterval = (fn, ms, ...rest) => {
    const t = realInterval(fn, ms, ...rest);
    t.unref?.();
    return t;
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0;
      setTimeout(() => {
        if (fail) {
          this.onerror?.();
          this.onclose?.({ code: 1006 });
          return;
        }
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result: rpcAnswer(method, params) }) }), 0);
    }
    close() {
      this.readyState = 3;
    }
  };
  globalThis.fetch = async (url) => {
    if (fail) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const body = indexerAnswer(`${u.pathname}${u.search}`, Date.now());
    return new Response(JSON.stringify(body ?? { error: 'no route' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
  };
  await import(`../../src/network/main.js?${fail ? 'fail' : absent.length ? 'absent' : 'ok'}`);
  const settle = async (pred, ms = 5_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await new Promise((r) => realTimeout(r, 20));
    }
    return false;
  };
  return { document: dom.window.document, settle };
}

export const statText = (document, key) => {
  const el = document.querySelector(`[data-stat="${key}"]`);
  return { value: el.querySelector('[data-value]').textContent.trim(), caption: el.querySelector('[data-caption]')?.textContent.trim() ?? '' };
};
