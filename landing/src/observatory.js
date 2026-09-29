// Live readings for /observatory.
//
// Every figure on the page is fetched here, in the reader's browser, from the
// public indexer API, the public RPC node, or GitHub. Three rules hold for all
// of them:
//
//   1. Provenance. Under each figure: the endpoint it came from and the UTC
//      time of the fetch. The figure itself links to the exact bytes that
//      response carried, so what is displayed can be checked against what was
//      received.
//   2. No stale values. A failed fetch replaces the figure with "unavailable"
//      and the reason. The previous value is never left standing.
//   3. No guessed fields. Responses are read through `field()`, which throws
//      on a missing key rather than defaulting, and test/observatory.test.mjs
//      checks every field path read here against the indexer's own source.
//
// Loaded as an ES module. Everything above `start()` is pure and is imported by
// the test suite under Node; `start()` only runs when there is a document.

export const API_ORIGIN = 'https://api.scalarnet.io';
// JSON-RPC over WebSocket rather than HTTPS POST. A browser POST needs CORS,
// and rpc.scalarnet.io currently answers POSTs with Access-Control-Allow-Origin
// sent twice (once by the node's --rpc-cors, once by nginx), which browsers
// reject outright. A WebSocket handshake is not subject to CORS.
export const RPC_URL = 'wss://rpc.scalarnet.io';
export const GITHUB_COMMITS_URL =
  'https://api.github.com/repos/tejaspatil1936/scalar-commons-v4/commits?sha=master&per_page=1';

// twox128("Session") ++ twox128("Validators"): the active validator set.
const SESSION_VALIDATORS_KEY = '0xcec5070d609dd3497f72bde07fc96ba088dcde934c658227ee1dfafcd6e16903';

// Blocks are six seconds apart, so the chain panel refreshes about once per
// block. Everything else moves slowly and is shared by every viewer behind one
// address against the edge's per-IP rate limit, so it is read less often: the
// validator set only changes at a session boundary, and upgrades are rare.
const CHAIN_INTERVAL_MS = 6_000;
const AGENTS_INTERVAL_MS = 30_000;
const SLOW_INTERVAL_MS = 60_000;
const CLOCK_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const SLASH_PAGE_SIZE = 200; // the indexer's MAX_LIMIT
const SLASH_MAX_PAGES = 5;

/**
 * Where each reading comes from. `readings` are the `data-reading` keys a
 * source feeds; the test suite checks every reading on the page has one.
 */
export const SOURCES = {
  status: {
    kind: 'api',
    path: '/v1/status',
    readings: ['bestBlock', 'finalizedBlock', 'finalityLag', 'specVersion'],
  },
  era: { kind: 'api', path: '/v1/eras/current', readings: ['era'] },
  upgrades: {
    kind: 'api',
    path: '/v1/events?section=system&method=CodeUpdated&limit=20',
    readings: ['lastUpgrade'],
  },
  validators: {
    kind: 'rpc',
    method: 'state_getStorage',
    params: [SESSION_VALIDATORS_KEY],
    label: 'state_getStorage(Session.Validators)',
    readings: ['validators'],
  },
  agents: { kind: 'api', path: '/v1/agents?limit=1', readings: ['agents'] },
  escrow: { kind: 'api', path: '/v1/escrows/stats', readings: ['activeAgreements', 'openDisputes'] },
  slashes: {
    kind: 'api',
    path: `/v1/events?section=agents&method=SlashExecuted&limit=${SLASH_PAGE_SIZE}`,
    readings: ['slashes'],
  },
  messages: { kind: 'api', path: '/v1/events?section=messages&method=MessageSent&limit=1', readings: ['messages'] },
  genesis: {
    kind: 'rpc',
    method: 'chain_getBlockHash',
    params: [0],
    label: 'chain_getBlockHash(0)',
    readings: ['genesis'],
  },
  lastMerge: { kind: 'github', url: GITHUB_COMMITS_URL, readings: ['lastMerge'] },
};

// ── pure helpers ─────────────────────────────────────────────────────────────

/**
 * Reads a dotted path out of a response, refusing to guess at a missing one.
 * A field that is not there is a decode mismatch, and it must surface as an
 * unavailable reading, not as a zero.
 */
export function field(value, path) {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`response has no ${path}`);
    }
    current = current[key];
  }
  if (current === undefined || current === null) {
    throw new Error(`response has no ${path}`);
  }
  return current;
}

/** The SCALE compact length prefix of a hex-encoded storage vector. */
export function decodeCompactLength(hex) {
  if (typeof hex !== 'string' || hex.replace(/^0x/, '').length < 2) {
    throw new Error('storage value is empty');
  }
  const bytes = hex
    .replace(/^0x/, '')
    .match(/../g)
    .map((pair) => parseInt(pair, 16));
  const mode = bytes[0] & 0b11;
  if (mode === 0) return bytes[0] >> 2;
  if (mode === 1) return (bytes[0] | (bytes[1] << 8)) >> 2;
  if (mode === 2) return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 2;
  throw new Error('length prefix too large for a validator set');
}

const integers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatInteger(value) {
  return integers.format(value);
}

/** "5 hours ago", from two epoch-millisecond instants. */
export function relativeTime(then, now) {
  const minutes = Math.floor((now - then) / 60_000);
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}

/**
 * Counts newest-first events at or after `startBlock`. `reachedStart` says the
 * page went back past the start, so there is nothing older left to count.
 */
export function countSince(items, startBlock) {
  let count = 0;
  for (const item of items) {
    if (item.blockNumber < startBlock) return { count, reachedStart: true };
    count += 1;
  }
  return { count, reachedStart: false };
}

function utcTime(date) {
  return `${date.toISOString().slice(11, 19)} UTC`;
}

// ── fetching ─────────────────────────────────────────────────────────────────

/**
 * One JSON-RPC call on a short-lived WebSocket: open, ask, close. A standing
 * socket per viewer would count against the edge's concurrent-connection
 * limit for everyone behind the same address; these are read once a minute.
 */
function rpcOverWebSocket(method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(RPC_URL);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no response within ${FETCH_TIMEOUT_MS / 1000} s`));
    }, FETCH_TIMEOUT_MS);
    const finish = (settle, value) => {
      clearTimeout(timer);
      socket.close();
      settle(value);
    };
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }));
    socket.onmessage = (event) => finish(resolve, String(event.data));
    socket.onerror = () => finish(reject, new Error('WebSocket connection failed'));
    socket.onclose = (event) => finish(reject, new Error(`WebSocket closed (code ${event.code}) before answering`));
  });
}

/**
 * One request, and everything the page needs to show where its answer came
 * from: the raw bytes, the time, a label for the provenance line, and a URL a
 * reader can re-open. Never throws; a failure is a record with `ok: false`.
 */
async function fetchSource(source, path = source.path) {
  const at = new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let url;
  let label;
  const init = { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json' } };

  if (source.kind === 'rpc') {
    clearTimeout(timer);
    // An RPC answer cannot be re-opened by URL, so there is no link; the
    // figure still links to the exact bytes received.
    const base = { at, label: `${RPC_URL.replace('wss://', '')} · ${source.label}`, link: null };
    try {
      const raw = await rpcOverWebSocket(source.method, source.params);
      const data = JSON.parse(raw);
      if (data.error) return { ...base, ok: false, raw, error: `RPC error ${data.error.code}: ${data.error.message}` };
      return { ...base, ok: true, raw, data };
    } catch (error) {
      return { ...base, ok: false, raw: null, error: `request failed: ${error.message}` };
    }
  }

  if (source.kind === 'api') {
    url = `${API_ORIGIN}${path}`;
    label = url.replace('https://', '');
  } else {
    url = source.url;
    label = url.replace('https://', '').replace(/\?.*$/, '');
  }
  const base = { at, label, link: url };

  try {
    const response = await fetch(url, init);
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...base, ok: false, raw, error: `HTTP ${response.status}, response is not JSON` };
    }
    if (!response.ok) {
      const detail = typeof data?.error === 'string' ? data.error : data?.message;
      return { ...base, ok: false, raw, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ...base, ok: true, raw, data };
  } catch (error) {
    const reason = error.name === 'AbortError' ? `no response within ${FETCH_TIMEOUT_MS / 1000} s` : error.message;
    return { ...base, ok: false, raw: null, error: `request failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── the page ─────────────────────────────────────────────────────────────────

function start() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const srStatus = document.querySelector('.sr-status');
  const live = document.querySelector('.live');
  const liveText = live.querySelector('.live-text');
  const pulse = live.querySelector('.pulse');

  /** Latest successful record per source, and the blob URL of its raw bytes. */
  const latest = {};
  const snapshots = new Map();
  const shown = new Map();

  function snapshotUrl(record) {
    if (record.raw === null) return null;
    const previous = snapshots.get(record);
    if (previous) return previous;
    const url = URL.createObjectURL(new Blob([record.raw], { type: 'application/json' }));
    snapshots.set(record, url);
    return url;
  }

  /** Releases blob URLs no reading points at any more. */
  function releaseSnapshots() {
    const inUse = new Set(shown.values());
    for (const [record, url] of snapshots) {
      if (!inUse.has(record)) {
        URL.revokeObjectURL(url);
        snapshots.delete(record);
      }
    }
  }

  const el = (key) => document.querySelector(`[data-reading="${key}"]`);

  function provenance(target, record, extra = '') {
    const prov = target.querySelector('.reading-prov');
    prov.replaceChildren();
    if (record.link) {
      const a = document.createElement('a');
      a.href = record.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = record.label;
      prov.append(a);
    } else {
      prov.append(record.label);
    }
    prov.append(` · ${utcTime(record.at)}${extra ? ` · ${extra}` : ''}`);
  }

  function rawLink(record, content) {
    const url = snapshotUrl(record);
    if (!url) return content;
    const a = document.createElement('a');
    a.className = 'num';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    const hint = document.createElement('span');
    hint.className = 'visually-hidden';
    hint.textContent = ' (raw JSON response, opens in a new tab)';
    a.append(content, hint);
    return a;
  }

  /** Counts from the previous integer to the new one over 200 ms. */
  function tick(digits, from, to) {
    if (reduceMotion.matches || document.hidden || !(to > from) || to - from > 100_000) {
      digits.textContent = formatInteger(to);
      return;
    }
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / 200);
      digits.textContent = formatInteger(Math.round(from + (to - from) * t));
      if (t < 1 && digits.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * Shows a figure. `value` is a number (ticked when it rises) or a string;
   * `prefix`/`unit` are set around it without being part of the link text's
   * figure.
   */
  function showValue(key, record, { value, prefix = '', unit = '', extra = '' }) {
    const target = el(key);
    if (!target) return;
    const slot = target.querySelector('.reading-value');
    const before = slot.dataset.number;
    slot.classList.remove('is-loading', 'is-error', 'is-absent');

    const digits = document.createElement('span');
    digits.className = 'digits';
    const figure = document.createDocumentFragment();
    if (prefix) figure.append(prefix);
    figure.append(digits);
    slot.replaceChildren(rawLink(record, figure));
    if (unit) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = unit;
      slot.append(u);
    }

    if (typeof value === 'number') {
      const previous = before === undefined ? NaN : Number(before);
      if (Number.isFinite(previous)) tick(digits, previous, value);
      else digits.textContent = formatInteger(value);
      slot.dataset.number = String(value);
    } else {
      digits.textContent = value;
      delete slot.dataset.number;
    }
    shown.set(key, record);
    provenance(target, record, extra);
  }

  /** Replaces a figure with the reason it could not be read. Never keeps the old value. */
  function showError(key, record, reason = record.error) {
    const target = el(key);
    if (!target) return;
    const slot = target.querySelector('.reading-value');
    slot.classList.remove('is-loading', 'is-absent');
    slot.classList.add('is-error');
    delete slot.dataset.number;
    const word = document.createElement('span');
    word.className = 'unavailable';
    word.textContent = 'unavailable';
    slot.replaceChildren(record.raw ? rawLink(record, word) : word);
    const why = document.createElement('span');
    why.className = 'error';
    why.textContent = reason;
    slot.append(why);
    shown.set(key, record);
    provenance(target, record, 'failed');
  }

  /** A reading with no figure to show yet, for a stated reason. */
  function showAbsent(key, record, reason) {
    const target = el(key);
    if (!target) return;
    const slot = target.querySelector('.reading-value');
    slot.classList.remove('is-loading', 'is-error');
    slot.classList.add('is-absent');
    delete slot.dataset.number;
    const dash = document.createElement('span');
    dash.className = 'digits';
    dash.textContent = '—';
    const why = document.createElement('span');
    why.className = 'error';
    why.textContent = reason;
    slot.replaceChildren(dash, why);
    shown.set(key, record);
    provenance(target, record);
  }

  /** Runs `render` against a record, turning any missing field into an honest failure. */
  function apply(keys, record, render) {
    if (!record.ok) {
      for (const key of keys) showError(key, record);
      return false;
    }
    try {
      render(record.data);
      return true;
    } catch (error) {
      for (const key of keys) showError(key, record, error.message);
      return false;
    }
  }

  function beat() {
    if (reduceMotion.matches) return;
    pulse.classList.remove('beat');
    void pulse.offsetWidth; // restart the one-shot animation
    pulse.classList.add('beat');
  }

  function setLive(state, text) {
    live.dataset.live = state;
    liveText.textContent = text;
  }

  // ── chain panel ──
  let lastSpec = null;
  let slowAt = 0;

  function renderEra(record) {
    const target = el('era');
    const bar = target.querySelector('.era-bar');
    const fill = bar.querySelector('.era-fill');
    const detail = target.querySelector('.era-detail');
    const ok = apply(['era'], record, (data) => {
      const era = field(data, 'era');
      const elapsed = field(data, 'blocksElapsed');
      const remaining = field(data, 'blocksRemaining');
      const duration = field(data, 'durationBlocks');
      const startBlock = field(data, 'startBlock');
      const due = field(data, 'dueForSettlement');
      showValue('era', record, { value: era });
      const share = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
      fill.style.transform = `scaleX(${share})`;
      bar.setAttribute('aria-valuemax', String(duration));
      bar.setAttribute('aria-valuenow', String(Math.min(elapsed, duration)));
      bar.setAttribute('aria-valuetext', `${formatInteger(elapsed)} of ${formatInteger(duration)} blocks`);
      bar.hidden = false;
      detail.textContent = due
        ? `Ended after ${formatInteger(duration)} blocks — awaiting settlement, which any account may trigger.`
        : `${formatInteger(remaining)} blocks remaining · ${formatInteger(elapsed)} of ${formatInteger(duration)} elapsed · settlement opens at block #${formatInteger(startBlock + duration)}`;
    });
    if (!ok) {
      bar.hidden = true;
      detail.textContent = '';
    }
  }

  async function chainTick() {
    const [status, era] = await Promise.all([fetchSource(SOURCES.status), fetchSource(SOURCES.era)]);

    const previousBest = latest.status?.ok ? latest.status.data.chain?.bestBlock : undefined;
    latest.status = status;
    latest.era = era;

    const statusOk = apply(SOURCES.status.readings, status, (data) => {
      const best = field(data, 'chain.bestBlock');
      const finalized = field(data, 'chain.finalizedBlock');
      const spec = field(data, 'chain.specVersion');
      showValue('bestBlock', status, { value: best });
      showValue('finalizedBlock', status, { value: finalized });
      const lag = Math.max(0, best - finalized);
      showValue('finalityLag', status, { value: lag, unit: lag === 1 ? ' block' : ' blocks' });
      showValue('specVersion', status, { value: spec });
      if (previousBest !== undefined && best > previousBest) beat();
      if (spec !== lastSpec) {
        lastSpec = spec;
        slowAt = 0; // a new runtime: re-read the upgrade block now
      }
    });

    renderEra(era);

    if (statusOk) setLive('live', 'Live');
    else setLive('down', 'Not updating — the last request failed');

    if (Date.now() - slowAt >= SLOW_INTERVAL_MS) {
      slowAt = Date.now();
      await Promise.all([validatorsTick(), upgradesTick()]);
    }
  }

  async function validatorsTick() {
    const record = await fetchSource(SOURCES.validators);
    apply(SOURCES.validators.readings, record, (data) => {
      showValue('validators', record, { value: decodeCompactLength(field(data, 'result')) });
    });
  }

  async function upgradesTick() {
    const record = await fetchSource(SOURCES.upgrades);
    const confirms = document.querySelectorAll('[data-confirm-block]');
    const ok = apply(SOURCES.upgrades.readings, record, (data) => {
      const newest = field(data, 'items.0.blockNumber');
      showValue('lastUpgrade', record, { value: newest, prefix: '#' });
      const seen = new Set(field(data, 'items').map((item) => item.blockNumber));
      for (const node of confirms) {
        const block = Number(node.dataset.confirmBlock);
        node.replaceChildren(
          seen.has(block)
            ? rawLink(record, document.createTextNode('confirmed on chain'))
            : document.createTextNode('not found in the index'),
        );
        node.dataset.state = seen.has(block) ? 'confirmed' : 'missing';
        node.title = `${record.label} · ${utcTime(record.at)}`;
      }
    });
    if (!ok) {
      for (const node of confirms) {
        node.textContent = 'could not be checked';
        node.dataset.state = 'error';
        node.title = `${record.label} · ${record.error}`;
      }
    }
  }

  // ── agents panel ──
  async function slashesThisEra() {
    const era = latest.era;
    if (!era.ok) return { record: era, error: 'needs the era start block, which could not be read' };
    const startBlock = field(era.data, 'startBlock');
    let count = 0;
    let complete = false;
    let first = null;
    for (let page = 0, offset = 0; page < SLASH_MAX_PAGES; page += 1) {
      const record = await fetchSource(SOURCES.slashes, `${SOURCES.slashes.path}&offset=${offset}`);
      first ??= record;
      if (!record.ok) return { record, error: record.error };
      const items = field(record.data, 'items');
      const total = field(record.data, 'total');
      const counted = countSince(items, startBlock);
      count += counted.count;
      offset += items.length;
      if (counted.reachedStart || offset >= total || items.length === 0) {
        complete = true;
        break;
      }
    }
    return { record: first, count, complete, startBlock };
  }

  async function agentsTick() {
    const [agents, escrow] = await Promise.all([fetchSource(SOURCES.agents), fetchSource(SOURCES.escrow)]);

    apply(SOURCES.agents.readings, agents, (data) => {
      // A truncated live scan is a floor, not a count, and is shown as one.
      const truncated = field(data, 'truncated');
      showValue('agents', agents, { value: field(data, 'total'), prefix: truncated ? '≥ ' : '' });
    });

    apply(SOURCES.escrow.readings, escrow, (data) => {
      const truncated = field(data, 'scanTruncated');
      showValue('activeAgreements', escrow, { value: field(data, 'activeAgreementCount') });
      showValue('openDisputes', escrow, {
        value: field(data, 'byStatus.Disputed'),
        prefix: truncated ? '≥ ' : '',
      });
    });

    try {
      const slashes = await slashesThisEra();
      if (slashes.error) showError('slashes', slashes.record, slashes.error);
      else
        showValue('slashes', slashes.record, {
          value: slashes.count,
          prefix: slashes.complete ? '' : '≥ ',
          extra: `since block #${formatInteger(slashes.startBlock)}`,
        });
    } catch (error) {
      showError('slashes', latest.era, error.message);
    }

    await messagesTick();
    releaseSnapshots();
  }

  async function messagesTick() {
    const target = el('messages');
    const since = Number(target.dataset.messagesSpec);
    const status = latest.status;
    if (!status.ok) {
      showError('messages', status, 'needs the runtime version, which could not be read');
      return;
    }
    let spec;
    try {
      spec = field(status.data, 'chain.specVersion');
    } catch (error) {
      showError('messages', status, error.message);
      return;
    }
    if (Number.isFinite(since) && spec < since) {
      // Not a failure and not a zero: the pallet that would count messages is
      // not in the runtime yet, which is itself a fact the status response shows.
      showAbsent('messages', status, `not on chain yet — messaging arrives with runtime ${since}; the chain runs ${spec}`);
      return;
    }
    const record = await fetchSource(SOURCES.messages);
    apply(SOURCES.messages.readings, record, (data) => {
      showValue('messages', record, { value: field(data, 'total') });
    });
  }

  // ── once per load ──
  async function genesisOnce() {
    const record = await fetchSource(SOURCES.genesis);
    apply(SOURCES.genesis.readings, record, (data) => {
      const hash = field(data, 'result');
      showValue('genesis', record, { value: hash });
      const dd = el('genesis').querySelector('dd');
      if (!dd.querySelector('.copy')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy';
        button.dataset.copy = hash;
        button.setAttribute('aria-label', 'Copy genesis hash');
        button.textContent = 'Copy';
        dd.querySelector('.reading-value').after(' ', button);
      }
    });
  }

  let mergeRecord = null;
  function renderMerge() {
    if (!mergeRecord) return;
    apply(SOURCES.lastMerge.readings, mergeRecord, (data) => {
      const date = Date.parse(field(data, '0.commit.committer.date'));
      if (Number.isNaN(date)) throw new Error('commit date is not a date');
      const sha = field(data, '0.sha');
      showValue('lastMerge', mergeRecord, { value: relativeTime(date, Date.now()) });
      const prov = el('lastMerge').querySelector('.reading-prov');
      const commit = document.createElement('a');
      commit.href = field(data, '0.html_url');
      commit.target = '_blank';
      commit.rel = 'noopener';
      commit.className = 'mono';
      commit.textContent = sha.slice(0, 7);
      prov.append(' · commit ', commit);
    });
  }

  async function mergeOnce() {
    mergeRecord = await fetchSource(SOURCES.lastMerge);
    renderMerge();
  }

  // ── copy controls ──
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('button.copy');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      srStatus.textContent = 'Copied to clipboard';
    } catch {
      button.textContent = 'Select and copy';
      srStatus.textContent = 'Copy failed; select the text to copy it';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 2000);
  });
  for (const button of document.querySelectorAll('button.copy')) button.hidden = false;

  // ── scheduling ──
  // One loop per panel, never overlapping itself, paused while the tab is
  // hidden: a projector tab left in the background should not keep polling.
  const loops = [
    { run: chainTick, every: CHAIN_INTERVAL_MS },
    { run: agentsTick, every: AGENTS_INTERVAL_MS, after: 0 },
    // Re-renders "N hours ago" against the clock; a failed GitHub read is
    // retried here rather than left as the answer for the rest of the visit.
    { run: async () => (mergeRecord?.ok ? renderMerge() : mergeOnce()), every: CLOCK_INTERVAL_MS },
  ];
  for (const loop of loops) loop.timer = null;

  function run(loop) {
    clearTimeout(loop.timer);
    loop.timer = null;
    if (document.hidden) return;
    loop
      .run()
      .catch((error) => console.error(error))
      .finally(() => {
        if (!document.hidden) loop.timer = setTimeout(() => run(loop), loop.every);
      });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const loop of loops) clearTimeout(loop.timer);
      setLive('paused', 'Paused while this tab is hidden');
    } else {
      for (const loop of loops) run(loop);
    }
  });

  // Chain first: the agents panel's slash count needs the era start block.
  chainTick()
    .catch((error) => console.error(error))
    .finally(() => {
      loops[0].timer = setTimeout(() => run(loops[0]), CHAIN_INTERVAL_MS);
      run(loops[1]);
      loops[2].timer = setTimeout(() => run(loops[2]), CLOCK_INTERVAL_MS);
    });
  genesisOnce();
  mergeOnce();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  start();
}
