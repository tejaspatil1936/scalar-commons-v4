// /network in the browser: reads the public node (one WebSocket) and the
// indexer, every 12 s while the tab is visible, and replaces each value in
// place — no animation, no canvas. A read that fails keeps the last value,
// marks it Stale and raises the warning callout with the plain cause; an
// unknown is never shown as zero. The node is read every tick; the indexer's
// heavier lists every fourth (48 s), so no figure is ever older than 60 s.
import { RpcSocket, fetchHttp } from '../observatory/data.js';
import { storageKey } from '../observatory/scale.js';
import { initChrome } from '../chrome/behaviour/index.js';
import { address, badge, callout, escapeHtml } from '../chrome/templates.mjs';
import * as M from './model.js';

const cfg = JSON.parse(document.getElementById('net-config').textContent);
const TICK_MS = 12_000;
const SLOW_EVERY = 4;
const STALE_MS = 60_000;
const rpc = new RpcSocket(cfg.rpc);

const $ = (sel, root = document) => root.querySelector(sel);
const explorer = (path) => `${cfg.explorer}${path}`;
const blockLink = (n) => `<a class="sc-num" href="${escapeHtml(explorer(`/block/${n}`))}">${M.int(n)}</a>`;
const acct = (a) => address(a, { href: explorer(`/account/${a}`) });
const muted = (text) => `<span class="sc-muted">${escapeHtml(text)}</span>`;
const NOT_READ = '<span class="sc-small sc-muted">Not read</span>';

// ── what the page knows ─────────────────────────────────────────────────────
const S = { head: null, finalized: null, kind: '', tick: 0, node: { ok: null, at: null, error: null }, activity: { ok: null, at: null, error: null }, lists: { ok: null, at: null, error: null } };
/** The indexer as the callout reports it: down if either of its reads failed last time; its values date from the older of the two. */
const indexer = () => ({ error: (S.lists.ok === false ? S.lists.error : S.activity.error) ?? '', ok: S.activity.ok === false || S.lists.ok === false ? false : S.activity.ok, at: Math.min(S.activity.at ?? Infinity, S.lists.at ?? Infinity) === Infinity ? null : Math.min(S.activity.at ?? Infinity, S.lists.at ?? Infinity) });
const shown = new Set(); // stats that hold a value read in this browser or at build
for (const el of document.querySelectorAll('[data-stat]')) if (!el.querySelector('.sc-skeleton')) shown.add(el.dataset.stat);

function setStat(key, value, caption = null) {
  const el = $(`[data-stat="${key}"]`);
  if (!el) return;
  $('[data-value]', el).innerHTML = value;
  const cap = $('[data-caption]', el);
  if (cap && caption !== null) cap.innerHTML = caption;
  shown.add(key);
}
function stale(keys) {
  for (const key of keys) {
    const el = $(`[data-stat="${key}"]`);
    if (!el) continue;
    if (!shown.has(key)) $('[data-value]', el).innerHTML = NOT_READ;
    const cap = $('[data-caption]', el);
    if (cap && !cap.querySelector('.sc-badge')) cap.insertAdjacentHTML('beforeend', ` ${badge('Stale')}`);
  }
}
/** A table still showing loading bars after a failed read says so in words instead. */
function unread(id, why) {
  const body = $(`#${id} tbody`);
  if (!body || !body.querySelector('.sc-skeleton')) return;
  // The scripts-off sentence row (.net-nojs-row) is never shown here, so it does not count as content.
  if ([...body.querySelectorAll('tr:not(.net-nojs-row) td')].every((td) => td.querySelector('.sc-skeleton') || !td.textContent.trim())) setRows(id, [], why);
  else for (const td of body.querySelectorAll('td')) if (td.querySelector('.sc-skeleton')) td.innerHTML = muted('Not read');
}
function markRead(keys, ok) {
  for (const key of keys) {
    const cell = $(`[data-read="${key}"]`);
    if (!cell) continue;
    if (!ok && cell.querySelector('.sc-skeleton')) cell.innerHTML = muted('Not read');
    if (ok) cell.textContent = `Block ${M.int(S.head ?? cfg.builtAtBlock)}, ${M.clock(Date.now())}`;
    else if (!cell.querySelector('.sc-badge')) cell.insertAdjacentHTML('beforeend', ` ${badge('Stale')}`);
  }
}
function setRows(id, rows, empty) {
  const body = $(`#${id} tbody`);
  if (!body) return;
  const cols = $(`#${id} thead tr`).children;
  // An empty table is one sentence in a panel: no header row to scroll past on a phone.
  $(`#${id} thead`).hidden = rows.length === 0;
  body.innerHTML = rows.length
    ? rows.map((r) => `<tr>${r.map((c, i) => `<td${cols[i]?.classList.contains('sc-r') ? ' class="sc-r"' : ''}>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="sc-empty-cell" colspan="${cols.length}">${escapeHtml(empty)}</td></tr>`;
}

// ── the node ────────────────────────────────────────────────────────────────
const call = async (method, params = []) => {
  const r = await rpc.call({ method, params, label: method });
  if (!r.ok) throw new Error(r.error);
  return r.data.result;
};
const KEYS = {
  validators: storageKey('Session', 'Validators'),
  queued: storageKey('Session', 'QueuedKeys'),
  babe: storageKey('Babe', 'Authorities'),
  seats: storageKey('Staking', 'ValidatorCount'),
  era: storageKey('Agents', 'EraNumber'),
  eraStart: storageKey('Emissions', 'EraStartBlock'),
  lastSettled: storageKey('Emissions', 'LastSettledEra'),
  lastEmission: storageKey('Emissions', 'LastEraEmission'),
  issuance: storageKey('Balances', 'TotalIssuance'),
  agents: storageKey('Agents', 'CounterForAgentStake'),
  agreements: storageKey('Escrow', 'ActiveAgreementCount'),
  fee: storageKey('AutoParams', 'CompletionFeeBps'),
};
const hashByNumber = new Map();
const blockByHash = new Map(); // hash → { header, extrinsics, ts }
const NODE_STATS = ['height', 'finalized', 'validators', 'era', 'agents', 'agreements', 'issued', 'lastEmission', 'settlement', 'registered'];
const NODE_READS = ['height', 'finalized', 'validators', 'era', 'agents', 'agreements', 'authors', 'issued', 'lastEmission', 'fee'];

async function readBlocks(best, fin) {
  const lo = Math.max(0, best - cfg.window + 1);
  const numbers = [];
  for (let n = best; n >= lo; n -= 1) numbers.push(n);
  await Promise.all(
    numbers.map(async (n) => {
      if (!(hashByNumber.has(n) && n <= fin)) hashByNumber.set(n, await call('chain_getBlockHash', [n]));
      const hash = hashByNumber.get(n);
      const wantBody = n > best - cfg.recent;
      const have = blockByHash.get(hash);
      if (have && (!wantBody || have.extrinsics !== null)) return;
      if (wantBody) {
        const { block } = await call('chain_getBlock', [hash]);
        blockByHash.set(hash, { header: block.header, extrinsics: block.extrinsics.length, ts: M.blockTimestamp(block.extrinsics, cfg.timestampPallet) });
      } else {
        blockByHash.set(hash, { header: await call('chain_getHeader', [hash]), extrinsics: null, ts: null });
      }
    }),
  );
  for (const n of hashByNumber.keys()) if (n < lo - 20) { blockByHash.delete(hashByNumber.get(n)); hashByNumber.delete(n); }
  return numbers.map((n) => ({ n, ...blockByHash.get(hashByNumber.get(n)) }));
}

async function readNode() {
  try {
    const [bestHeader, finHash, ...values] = await Promise.all([call('chain_getHeader'), call('chain_getFinalizedHead'), ...Object.values(KEYS).map((k) => call('state_getStorage', [k]))]);
    const v = Object.fromEntries(Object.keys(KEYS).map((k, i) => [k, values[i]]));
    const best = M.headerNumber(bestHeader);
    const fin = M.headerNumber(await call('chain_getHeader', [finHash]));
    S.head = best;
    S.finalized = fin;
    const set = M.buildSet({ validators: M.decodeValidators(v.validators), queued: v.queued ? M.decodeQueuedKeys(v.queued) : null, babe: v.babe ? M.decodeBabeAuthorities(v.babe) : null, ss58: cfg.ss58 });
    const u32 = (hex) => (hex ? M.decodeUint(hex, 4) : null);
    const n = { seats: u32(v.seats), era: u32(v.era), eraStart: u32(v.eraStart), lastSettled: u32(v.lastSettled), agents: u32(v.agents), agreements: u32(v.agreements), fee: u32(v.fee) };
    const issuance = v.issuance ? M.decodeUint(v.issuance, 16) : null;
    const lastEmission = v.lastEmission ? M.decodeUint(v.lastEmission, 16) : null;
    const blocks = await readBlocks(best, fin);
    const now = Date.now();

    setStat('height', M.int(best));
    setStat('finalized', M.int(fin));
    setStat('validators', M.int(set.active.length), n.seats === null ? '' : `of ${M.int(n.seats)} seats`);
    if (n.era !== null && n.eraStart !== null) {
      setStat('era', M.int(n.era), `${M.int(best - n.eraStart)} / ${M.int(cfg.eraBlocks)} blocks`);
      const next = n.eraStart + cfg.eraBlocks;
      const left = next - best;
      setStat('settlement', M.int(next), left > 0 ? escapeHtml(`≈ ${M.utc(now + left * cfg.blockMs)} (in ${M.durationNb((left * cfg.blockMs) / 1000)})`) : 'Due now: anyone may settle it');
      const cell = $('[data-param="eraStart"]');
      if (cell) cell.innerHTML = blockLink(n.eraStart);
    }
    if (n.agents !== null) {
      setStat('agents', M.int(n.agents));
      setStat('registered', M.int(n.agents), '');
    }
    if (n.agreements !== null) setStat('agreements', M.int(n.agreements), '');
    if (issuance !== null) {
      const pct = Number((BigInt(issuance) * 10000n) / BigInt(cfg.supplyCap)) / 100;
      setStat('issued', `<span title="${escapeHtml(M.cmnExact(issuance, cfg.decimals, cfg.symbol))}">${escapeHtml(M.cmnShort(issuance, cfg.decimals, ''))}</span>`, `${pct} % of the cap`);
    }
    if (lastEmission !== null) setStat('lastEmission', `<span title="${escapeHtml(M.cmnExact(lastEmission, cfg.decimals, cfg.symbol))}">${escapeHtml(M.cmnShort(lastEmission, cfg.decimals, ''))}</span>`, n.lastSettled === null ? '' : `Era ${M.int(n.lastSettled)}`);
    if (n.fee !== null) {
      const cell = $('[data-param="fee"]');
      if (cell) cell.textContent = M.bps(n.fee);
    }
    // A storage item the node returned nothing for (absent, or a key this runtime does not have)
    // says so: never a loading bar left in place, and never a zero the page did not read.
    for (const key of NODE_STATS) {
      const el = shown.has(key) ? null : $(`[data-stat="${key}"] [data-value]`);
      if (el) el.innerHTML = NOT_READ;
    }

    // Validators: authorship over the headers read.
    const headers = blocks.map((b) => b.header).filter(Boolean);
    const by = M.authorship(headers, set.authorities);
    const rows = [...set.active, ...set.queued].map((val, i) => {
      const a = by.get(val.stashHex);
      const known = Boolean(set.authorities);
      return [
        M.int(i + 1),
        acct(val.address),
        badge(val.queued ? 'Queued' : 'Active'),
        known ? M.int(a?.count ?? 0) : muted('Not known'),
        a?.last ? blockLink(a.last) : muted('None'),
      ];
    });
    setRows('validators-table', rows, 'No validators were read.');
    const w = $('[data-window]');
    if (w) w.textContent = `Blocks authored and last block count the last ${M.int(headers.length)} blocks, ${M.int(best - headers.length + 1)} to ${M.int(best)}.`;
    const th = $('#validators-table thead th:nth-child(4)');
    if (th) th.textContent = `Blocks authored (last ${M.int(headers.length)} blocks)`;

    // Recent blocks.
    const addrByStash = new Map([...set.active, ...set.queued].map((x) => [x.stashHex, x.address]));
    setRows(
      'blocks-table',
      blocks.slice(0, cfg.recent).map((b) => {
        const author = M.authorOf(b.header, set.authorities);
        return [
          blockLink(b.n),
          b.ts ? `<span title="${escapeHtml(M.utc(b.ts))}">${escapeHtml(M.ago(b.ts, now))}</span>` : muted('Not known'),
          author && addrByStash.has(author) ? acct(addrByStash.get(author)) : muted('Not known'),
          b.extrinsics === null ? muted('Not read') : M.int(b.extrinsics),
          b.n <= fin ? badge('Finalized') : badge('Pending'),
        ];
      }),
      'No blocks were read.',
    );
    S.node = { ok: true, at: now, error: null };
    markRead(NODE_READS, true);
  } catch (error) {
    S.node = { ...S.node, ok: false, error: error.message };
    stale(NODE_STATS);
    markRead(NODE_READS, false);
    for (const id of ['validators-table', 'blocks-table']) unread(id, 'Not read: the node did not answer.');
  }
}

// ── the indexer ─────────────────────────────────────────────────────────────
async function get(path) {
  const r = await fetchHttp({ kind: 'api', path: `/v1${path}` });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
async function getAll(path, max = 10) {
  const first = await get(`${path}${path.includes('?') ? '&' : '?'}limit=200`);
  const items = [...first.items];
  for (let page = 1; page < max && items.length < first.total; page += 1) {
    const next = await get(`${path}${path.includes('?') ? '&' : '?'}limit=200&offset=${items.length}`);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return { ...first, items };
}
const hourFrom = () => (S.head ?? cfg.builtAtBlock) - cfg.hourBlocks;

async function readActivity() {
  const kind = S.kind;
  try {
    const page = await get(`/activity?limit=${cfg.activityLimit}${kind ? `&kind=${kind}` : ''}`);
    if (kind !== S.kind) return;
    const now = Date.now();
    const recent = page.items.filter((e) => e.blockNumber >= hourFrom());
    setRows(
      'activity-table',
      recent.map((e) => {
        const b = M.eventBadge(e);
        return [
          `<span title="${escapeHtml(M.utc(e.timestampMs))}">${escapeHtml(M.ago(e.timestampMs, now))}</span>`,
          `${escapeHtml(M.eventWords(e))}${b ? ` ${badge(b)}` : ''}`,
          e.agents.map(acct).join('<br>'),
          escapeHtml(M.eventDetails(e, cfg.decimals, cfg.symbol)),
        ];
      }),
      M.emptyActivity(kind, page.items[0]?.blockNumber ?? null),
    );
    S.activity = { ok: true, at: now, error: null };
    markRead(['activity'], true);
  } catch (error) {
    S.activity = { ...S.activity, ok: false, error: error.message };
    markRead(['activity'], false);
    unread('activity-table', 'Not read: the indexer did not answer.');
  }
}

async function readLists() {
  const results = await Promise.allSettled([getAll('/agents'), getAll('/escrows'), get('/events?section=messages&method=MessageSent&limit=1'), get('/events?section=agents&method=SlashExecuted&limit=200')]);
  const [agents, escrows, messages, slashes] = results;
  const head = S.head ?? cfg.builtAtBlock;
  const failed = results.find((r) => r.status === 'rejected');
  if (agents.status === 'fulfilled') {
    const f = M.agentFigures(agents.value.items, head, cfg.grace);
    const cap = $('[data-stat="agents"] [data-caption]');
    if (cap) cap.textContent = `${M.int(f.operatorRun)} operator-run`;
    setStat('active', M.int(f.active), `Of ${M.int(f.registered)}; a heartbeat in the last ${M.int(cfg.grace)} blocks`);
    setRows(
      'agents-table',
      f.newest.map((a) => {
        const name = a.metadata?.name;
        const status = a.unstakeAtBlock !== null && a.unstakeAtBlock !== undefined ? muted(`Leaving at block ${M.int(a.unstakeAtBlock)}`) : M.isActive(a, head, cfg.grace) ? badge('Active') : muted('No recent heartbeat');
        return [`${name ? `${escapeHtml(name)}<br>` : ''}${acct(a.address)}`, blockLink(a.registeredAtBlock), M.isOperatorRun(a) ? badge('Operator-run') : '', status];
      }),
      'No agents are registered.',
    );
    markRead(['agentList'], true);
  } else {
    stale(['active']);
    markRead(['agentList'], false);
    unread('agents-table', 'Not read: the indexer did not answer.');
  }
  if (escrows.status === 'fulfilled') {
    const d = M.disputeFigures(escrows.value.items);
    if (!escrows.value.truncated) {
      setStat('disputes', M.int(d.disputes), '');
      setStat('inDispute', M.int(d.agents), '');
    } else {
      const open = $('[data-stat="agreements"] [data-value]')?.textContent ?? '';
      setStat('inDispute', `${M.int(d.agents)} or more`, escapeHtml(`From the ${M.int(escrows.value.items.length)} agreements the indexer could read${open ? ` of ${open} open` : ''}`));
    }
    markRead(['escrows'], true);
  } else {
    stale(['disputes', 'inDispute']);
    markRead(['escrows'], false);
  }
  if (messages.status === 'fulfilled') {
    setStat('messages', M.int(messages.value.total), '');
    markRead(['messages'], true);
  } else {
    stale(['messages']);
    markRead(['messages'], false);
  }
  if (slashes.status === 'fulfilled') {
    const items = slashes.value.items;
    const k = M.countSince(items, hourFrom());
    const capped = items.length === 200 && k === items.length;
    setStat('slashed', capped ? `${M.int(k)} or more` : M.int(k), `Since block ${M.int(hourFrom())}`);
    markRead(['slashes'], true);
  } else {
    stale(['slashed']);
    markRead(['slashes'], false);
  }
  if (failed) S.lists = { ...S.lists, ok: false, error: failed.reason?.message ?? 'no answer' };
  else S.lists = { ok: true, at: Date.now(), error: null };
}

// ── the callout and the "Updated" line ─────────────────────────────────────
let lastAlert = '';
function renderAlert() {
  const since = (at) => (at ? M.utc(at) : `when this page was built, ${M.utc(cfg.builtAt)}`);
  let body = '';
  const ix = indexer();
  if (S.node.ok === false && ix.ok === false) body = `Can’t reach the node (${cfg.rpc}) or the indexer (${cfg.api}). Values are from ${since(S.node.at)}.`;
  else if (S.node.ok === false) body = `Can’t reach the node (${cfg.rpc}). Values are from ${since(S.node.at)}.`;
  else if (ix.ok === false) {
    const code = ix.error.match(/^HTTP (\d+)/)?.[1];
    body = `${code ? `The indexer (${cfg.api}) answered with an error (HTTP ${code})` : `Can’t reach the indexer (${cfg.api})`}. Values from it are from ${since(ix.at)}.`;
  }
  else if (S.node.at && Date.now() - S.node.at > STALE_MS) body = `These figures are more than a minute old. They were read ${since(S.node.at)}.`;
  if (body === lastAlert) return;
  lastAlert = body;
  $('[data-alert]').innerHTML = body ? callout({ variant: 'warning', body: escapeHtml(body) }) : '';
}
function renderUpdated() {
  const el = $('[data-updated]');
  if (!el || !S.node.at) return;
  const s = Math.round((Date.now() - S.node.at) / 1000);
  el.textContent = s < 60 ? `Updated ${s} s ago.` : `Updated ${Math.floor(s / 60)} min ago.`;
  renderAlert();
}

// ── the loop ────────────────────────────────────────────────────────────────
let timer = null;
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  clearTimeout(timer);
  const slow = S.tick % SLOW_EVERY === 0;
  S.tick += 1;
  try {
    await readNode();
    await Promise.all([readActivity(), slow ? readLists() : null]);
  } catch (error) {
    // A response the page could not use: said in the callout, and the next tick tries again.
    S.lists = { ...S.lists, ok: false, error: error.message };
  } finally {
    renderAlert();
    renderUpdated();
    busy = false;
    if (document.visibilityState === 'visible') timer = setTimeout(tick, TICK_MS);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    rpc.resume();
    tick();
  } else {
    clearTimeout(timer);
    rpc.pause();
  }
});
setInterval(() => document.visibilityState === 'visible' && renderUpdated(), 1000);

// Filter chips: the indexer's own `?kind=`, read at once.
for (const chip of document.querySelectorAll('.sc-chip[data-filter]')) {
  chip.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.sc-chip[data-filter]')) other.setAttribute('aria-pressed', String(other === chip));
    S.kind = chip.dataset.filter === 'all' ? '' : chip.dataset.filter;
    readActivity().then(renderAlert);
  });
}

initChrome();
if (document.visibilityState === 'visible') tick();
