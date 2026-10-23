// The network page's one script (bundled to network.js). It fills every
// figure the frame left as a skeleton from the public node (one WebSocket:
// new and finalized heads pushed, storage read raw and decoded) and the
// indexer (polled, /v1/status every 12 s, the lists less often), and keeps
// them current while the tab is visible. The rules (SITE-REDESIGN.md §7):
// values replace text in place; "Updated n s ago" under the status row; a
// read that fails keeps the last value, marks its figure Stale and puts the
// plain reason in one warning above the row; a figure never shows zero for
// an unknown; nothing animates; nothing polls while the tab is hidden; every
// read stamps its block and time into the sources table.
import { initChrome } from '../chrome/behaviour/index.js';
import { badge, callout, escapeHtml, formatInt, formatUtc } from '../chrome/templates.mjs';
import {
  ACTIVITY_ROWS,
  AGENT_ROWS,
  BLOCK_ROWS,
  BLOCK_WINDOW,
  RpcSocket,
  Scheduler,
  SOURCES,
  activitySource,
  blockHashSource,
  blockSource,
  failureReason,
  failureSentences,
  fetchAllPages,
  fetchHttp,
  field,
  headerSource,
} from './data.js';
import { KINDS } from './events.js';
import { compactCmn, formatBps, formatCmn, formatDuration, relativeTime } from './format.js';
import {
  activityEmpty,
  agentSummary,
  authorOf,
  authoredCounts,
  blockLog,
  hourWindow,
  nextSettlement,
  openDisputes,
  sinceBlock,
  validatorSet,
  warningText,
} from './model.js';
import { COLUMNS, activityRow, agentRow, blockRow, readCell, tr, validatorRow } from './rows.js';
import { babePreDigestOf, decodeBabeAuthorities, decodeQueuedKeys, decodeU32, decodeValidators, headerNumber, timestampOf } from './scale.js';

const FAST_MS = 12_000; // /v1/status and /v1/eras/current
const LIST_MS = 30_000; // the escrow stats, the messages total, the activity feed
const SLOW_MS = 60_000; // the agents, the disputes, the supply, the emissions, the slashes, the validator storage
const TICK_MS = 5_000; // "Updated n s ago" and every relative time
const HEADS_LIVE_MS = 30_000; // no head pushed for this long: the heads come from /v1/status until the stream resumes

/** Which stats each source feeds, so a failed read marks exactly those Stale. */
const STAT_SOURCES = {
  status: [],
  era: ['era', 'settlement'],
  validators: ['validators'],
  queuedKeys: [],
  babeAuthorities: [],
  validatorCount: ['validators'],
  agents: ['agents', 'registered', 'active', 'inDispute'],
  disputesOpened: ['disputes', 'inDispute'],
  disputesResolved: ['disputes', 'inDispute'],
  escrowStats: ['agreements'],
  messagesSent: ['messages'],
  supply: ['issued', 'cap'],
  emissions: ['lastEra'],
  slashes: ['slashedHour'],
  blocks: [],
  activity: [],
  socket: ['validators'],
};

// ── the DOM, in a few helpers ────────────────────────────────────────────────
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const statEl = (key) => $(`[data-stat="${key}"]`);

/** Puts a value (and a caption) into a stat, in place; ends its stale state. */
function setStat(key, value, { caption, title = null } = {}) {
  const el = statEl(key);
  if (!el) return;
  const v = $('[data-value]', el);
  if (v) {
    if (v.innerHTML !== value) v.innerHTML = value;
    if (title) v.title = title;
    else v.removeAttribute('title');
  }
  const c = $('[data-caption]', el);
  if (c && caption !== undefined) {
    let text = $('[data-text]', c);
    if (!text) {
      c.replaceChildren();
      text = document.createElement('span');
      text.setAttribute('data-text', '');
      c.append(text);
    }
    if (text.innerHTML !== caption) text.innerHTML = caption;
  }
  clearStale(key);
}

/** Keeps the stat's last value and adds the Stale badge; a stat never read shows a dash with the reason in its title. */
function markStale(key, reason) {
  const el = statEl(key);
  if (!el) return;
  const v = $('[data-value]', el);
  if (v && $('.sc-skeleton', v)) {
    v.innerHTML = '—';
    v.title = reason;
  }
  const c = $('[data-caption]', el);
  if (!c) return;
  if ($('.sc-skeleton', c)) c.replaceChildren();
  if (!$('.sc-badge', c)) c.insertAdjacentHTML('beforeend', ` ${badge('Stale')}`);
  el.setAttribute('data-stale', '');
}

function clearStale(key) {
  const el = statEl(key);
  if (!el) return;
  el.removeAttribute('data-stale');
  $$('.sc-badge', $('[data-caption]', el) ?? el).forEach((b) => b.remove());
}

/** Replaces a table's rows in place. */
function setRows(tableId, rowsHtml) {
  const body = $(`#${tableId} tbody`);
  if (body && body.innerHTML !== rowsHtml) body.innerHTML = rowsHtml;
}
const emptyRow = (columns, sentence) => `<tr><td class="sc-empty-cell" colspan="${columns.length}">${escapeHtml(sentence)}</td></tr>`;

/** Reads the facts the frame embedded (block time, heartbeat grace, decimals). */
function embeddedFacts() {
  const node = document.getElementById('network-facts');
  if (!node) throw new Error('the page carries no network-facts');
  return JSON.parse(node.textContent);
}

// ── boot ─────────────────────────────────────────────────────────────────────
function boot() {
  initChrome(document);
  const facts = embeddedFacts();
  const socket = new RpcSocket();
  const scheduler = new Scheduler((source) => (source.kind === 'rpc' ? socket.call(source) : fetchHttp(source)));
  const paged = new Scheduler((source) => fetchAllPages(source, { maxPages: source.maxPages ?? 5 }));
  const watch = (name, handler, interval, source = SOURCES[name]) => scheduler.watch(name, source, handler, interval);
  const watchAll = (name, handler, interval, maxPages = 5) => paged.watch(name, { ...SOURCES[name], maxPages }, handler, interval);
  const now = () => Date.now();

  // ── state ──
  const failures = new Map(); // source name → failed record
  let lastOkAt = null; // the newest successful read of anything
  let status = null; // the latest /v1/status body
  let best = null; // the chain head the page knows
  let finalized = null;
  let socketOpen = false;
  let lastHeadAt = null; // when the socket last pushed a head: an open socket that pushes nothing is not live
  let hour = null; // the index's newest hour: { since, to, best, behind }
  let set = null; // the validator set
  let seats = null;
  let era = null; // the latest /v1/eras/current body
  let agents = null; // the latest agents record (items, total, complete)
  let disputed = { count: null, agents: new Set(), complete: true, read: 0 };
  let slashRecord = null;
  let activityKind = '';
  let activityRecord = null;
  const log = blockLog(BLOCK_WINDOW);
  const records = { validators: null, queued: null, babe: null };

  // ── bookkeeping every read shares ──
  const blockFor = (source) => (source?.reads === 'index' ? (status ? field(status, 'indexer.syncedHeight') : null) : best);
  function stamp(key, record, block = blockFor(record.source)) {
    for (const cell of $$(`[data-read="${key}"]`)) cell.textContent = readCell(block, record.at);
  }
  function ok(name, record) {
    lastOkAt = Math.max(lastOkAt ?? 0, record.at.getTime());
    if (failures.delete(name)) renderWarning();
    for (const key of STAT_SOURCES[name] ?? []) clearStale(key);
  }
  function failed(name, record) {
    failures.set(name, record);
    const reason = failureReason(record);
    for (const key of STAT_SOURCES[name] ?? []) markStale(key, reason);
    renderWarning();
  }
  /** Runs `render` against a successful record; a thrown decode is a failed read. */
  function apply(name, record, render) {
    if (!record.ok) {
      failed(name, record);
      return false;
    }
    const wasFailing = failures.delete(name); // the render sees the read as good; a throw below puts it back
    try {
      render(record.data, record);
      if (wasFailing) failures.set(name, record);
      ok(name, record);
      return true;
    } catch (error) {
      failed(name, { ...record, ok: false, error: error.message });
      return false;
    }
  }

  function renderWarning() {
    const stack = $('#status .sc-stack');
    if (!stack) return;
    const text = warningText({ failures, lastOkAt, nowMs: now(), formatUtc, sentencesOf: failureSentences });
    const existing = $('[data-warning]', stack);
    if (!text) {
      existing?.remove();
      return;
    }
    const html = callout({ variant: 'warning', body: escapeHtml(text) }).replace('<div class="sc-callout', '<div data-warning class="sc-callout');
    if (existing) {
      if (existing.outerHTML !== html) existing.outerHTML = html;
    } else stack.insertAdjacentHTML('afterbegin', html);
  }

  function tick() {
    if (document.hidden) return;
    const t = now();
    const updated = $('[data-updated]');
    if (updated && lastOkAt) {
      updated.textContent = `Updated ${relativeTime(lastOkAt, t)}`;
      updated.title = formatUtc(new Date(lastOkAt).toISOString());
    }
    for (const el of $$('time[data-rel]')) {
      const ms = Date.parse(el.getAttribute('datetime'));
      if (Number.isFinite(ms)) el.textContent = relativeTime(ms, t);
    }
    renderWarning();
  }

  // ── heads: the status row's first two figures, and the blocks table ──
  function setHead(number) {
    if (!Number.isInteger(number)) return;
    best = number;
    setStat('height', formatInt(number));
    renderEra();
  }
  function setFinalized(number) {
    if (!Number.isInteger(number)) return;
    finalized = number;
    setStat('finalized', formatInt(number));
    renderBlocks();
  }

  /** Who authored a block, for its row: null while its header is unread, the reason when that read failed, false when the header names nobody, else the account or the unmapped index. */
  const authorFor = (block) => {
    if (!block.authorRead) return block.authorFailed ? { failed: block.authorFailed } : null;
    if (!Number.isInteger(block.authorityIndex)) return false;
    const stashHex = set?.authorities?.[block.authorityIndex] ?? null;
    const v = stashHex ? [...set.active, ...set.queued].find((x) => x.stashHex === stashHex) : null;
    return v ? { address: v.address } : { authorityIndex: block.authorityIndex };
  };
  function renderBlocks() {
    const rows = log.rows(BLOCK_ROWS);
    if (rows.length === 0) return;
    const t = now();
    setRows('blocks-table', rows.map((b) => tr(COLUMNS.blocks, blockRow(b, { finalized, nowMs: t, authorOf: authorFor }), ` data-block="${b.number}"`)).join(''));
  }

  /**
   * The reads for a block the page learned of by number: its hash, then its
   * body (the extrinsics and the chain's own time for it) and, for a block
   * whose header the page never saw, the header (its author).
   */
  async function readBlock(number, { withHeader = false } = {}) {
    const hashRecord = await socket.call(blockHashSource(number));
    if (!hashRecord.ok) return;
    const hash = hashRecord.data;
    const [bodyRecord, headerRecord] = await Promise.all([socket.call(blockSource(hash)), withHeader ? socket.call(headerSource(hash)) : null]);
    try {
      if (bodyRecord.ok) {
        const extrinsics = field(bodyRecord.data, 'block.extrinsics');
        log.add({ number, hash, extrinsics: extrinsics.length, timestampMs: extrinsics.length ? timestampOf(extrinsics[0]) : null });
      }
      if (headerRecord?.ok) log.add({ number, authorityIndex: babePreDigestOf(headerRecord.data)?.authorityIndex ?? null, authorRead: true });
      renderBlocks();
      if (headerRecord?.ok) renderValidators();
    } catch (error) {
      console.error(error);
    }
  }

  socket.on('state', ({ state, detail }) => {
    socketOpen = state === 'open';
    if (socketOpen) {
      if (failures.delete('socket')) renderWarning();
      clearStale('validators');
    } else if (state === 'failed' || state === 'closed') {
      failed('socket', { source: { kind: 'socket' }, error: detail ?? state, at: new Date() });
    }
  });
  socket.on('subscription-error', ({ error }) => failed('socket', { source: { kind: 'socket' }, error: error.message, at: new Date() }));

  socket.subscribe(SOURCES.newHeads, (record) => {
    let number;
    try {
      number = headerNumber(record.data);
    } catch (error) {
      console.error(error);
      return;
    }
    ok('newHeads', record);
    lastHeadAt = now();
    setHead(number);
    stamp('newHeads', record, number);
    let authorityIndex = null;
    try {
      authorityIndex = babePreDigestOf(record.data)?.authorityIndex ?? null;
    } catch (error) {
      console.error(error);
    }
    // A head the stream skipped (the socket reconnected, say) is read by number so the table has no gap.
    const previous = log.head();
    log.add({ number, authorityIndex, authorRead: true });
    renderBlocks();
    renderValidators();
    readBlock(number);
    if (previous !== null && number - previous > 1 && number - previous <= BLOCK_ROWS) {
      for (let n = previous + 1; n < number; n += 1) if (!log.get(n)) readBlock(n, { withHeader: true });
    }
  });
  socket.subscribe(SOURCES.finalizedHeads, (record) => {
    try {
      const number = headerNumber(record.data);
      ok('finalizedHeads', record);
      setFinalized(number);
      stamp('finalizedHeads', record, number);
    } catch (error) {
      console.error(error);
    }
  });

  // ── /v1/status: the index's position, the hour, and the heads while the socket is down ──
  watch(
    'status',
    (record) => {
      // The heads are live while the socket is open and has pushed one in the last HEADS_LIVE_MS; otherwise this poll carries them.
      const live = socketOpen && lastHeadAt !== null && now() - lastHeadAt < HEADS_LIVE_MS;
      if (!record.ok && !live) {
        markStale('height', failureReason(record));
        markStale('finalized', failureReason(record));
      }
      apply('status', record, (data) => {
        status = data;
        hour = hourWindow(data, field);
        const chainBest = field(data, 'chain.bestBlock');
        const chainFinal = field(data, 'chain.finalizedBlock');
        if (!live) {
          setHead(chainBest);
          setFinalized(chainFinal);
          stamp('newHeads', record, chainBest);
          stamp('finalizedHeads', record, chainFinal);
          scheduler.refresh('blocks');
        }
        renderSlashes();
        renderActivity();
      });
    },
    FAST_MS,
  );

  // ── the era ──
  function renderEra() {
    // A failed era read keeps its last body for the elapsed count but stays Stale until the next read succeeds.
    if (!era || failures.has('era')) return;
    const start = field(era, 'startBlock');
    const duration = field(era, 'durationBlocks');
    const elapsed = Math.max(0, Math.min(duration, (best ?? field(era, 'currentBlock')) - start));
    setStat('era', formatInt(field(era, 'era')), { caption: `${formatInt(elapsed)} / ${formatInt(duration)} blocks` });
  }
  watch(
    'era',
    (record) => {
      apply('era', record, (data) => {
        era = data;
        renderEra();
        const next = nextSettlement(data, field, { blockMs: facts.blockMs });
        setStat('settlement', formatInt(next.block), { caption: next.due ? 'Due now; anyone may settle it' : `${formatDuration(next.seconds)} from now` });
        const param = (key, value) => {
          const cell = $(`[data-param="${key}"]`);
          if (cell && cell.innerHTML !== value) cell.innerHTML = value;
        };
        param('era', formatInt(field(data, 'era')));
        param('startBlock', formatInt(field(data, 'startBlock')));
        stamp('era', record);
      });
    },
    FAST_MS,
  );

  // ── validators ──
  function renderValidators() {
    if (!set) return;
    const window = log.rows(BLOCK_WINDOW);
    const read = window.filter((b) => Number.isInteger(b.authorityIndex));
    const authored = authoredCounts(read.map((b) => ({ number: b.number, authorHex: set.authorities[b.authorityIndex] ?? null })));
    const all = [...set.active, ...set.queued];
    setRows('validators-table', all.map((v) => tr(COLUMNS.validators, validatorRow(v, authored, { windowSize: read.length }))).join(''));
  }
  function rebuildSet() {
    const record = records.validators;
    if (!record) return;
    apply('validators', record, (data) => {
      const validators = decodeValidators(data);
      let queued = null;
      let babe = null;
      if (records.queued?.ok) {
        try {
          queued = decodeQueuedKeys(records.queued.data);
        } catch (error) {
          failed('queuedKeys', { ...records.queued, ok: false, error: error.message });
        }
      }
      if (records.babe?.ok) {
        try {
          babe = decodeBabeAuthorities(records.babe.data);
        } catch (error) {
          failed('babeAuthorities', { ...records.babe, ok: false, error: error.message });
        }
      }
      set = validatorSet({ validators, queued, babe });
      setStat('validators', formatInt(set.active.length), { caption: seats === null ? '' : `of ${formatInt(seats)} seats` });
      stamp('validators', record);
      renderValidators();
      renderBlocks();
    });
  }
  watch('validators', (record) => { records.validators = record; rebuildSet(); }, SLOW_MS);
  watch('queuedKeys', (record) => { records.queued = record; if (record.ok) ok('queuedKeys', record); else failed('queuedKeys', record); rebuildSet(); }, SLOW_MS);
  watch('babeAuthorities', (record) => { records.babe = record; if (record.ok) ok('babeAuthorities', record); else failed('babeAuthorities', record); rebuildSet(); }, SLOW_MS);
  watch(
    'validatorCount',
    (record) => {
      apply('validatorCount', record, (data) => {
        seats = decodeU32(data);
        if (set) setStat('validators', formatInt(set.active.length), { caption: `of ${formatInt(seats)} seats` });
      });
    },
    SLOW_MS,
  );

  // ── the first rows of the blocks table, and the authors of the last BLOCK_WINDOW blocks ──
  /** The authors of the blocks whose headers the page has not read: one header read each, over the socket. */
  async function readAuthors(items) {
    const unread = items.filter((item) => !log.get(item.number)?.authorRead);
    if (unread.length === 0) return;
    const headers = await Promise.all(unread.map((item) => socket.call(headerSource(item.hash))));
    headers.forEach((h, i) => {
      if (!h.ok) {
        log.add({ number: unread[i].number, authorFailed: failureReason(h) });
        return;
      }
      try {
        log.add({ number: unread[i].number, authorityIndex: babePreDigestOf(h.data)?.authorityIndex ?? null, authorRead: true });
      } catch (error) {
        console.error(error);
      }
    });
    renderBlocks();
    renderValidators();
  }
  watch(
    'blocks',
    (record) => {
      let items = [];
      const shown = apply('blocks', record, (data) => {
        items = field(data, 'items');
        for (const item of items) {
          log.add({ number: field(item, 'number'), hash: field(item, 'hash'), timestampMs: Number(field(item, 'timestampMs')), extrinsics: field(item, 'extrinsicCount') });
        }
        stamp('blocks', record);
        renderBlocks();
      });
      if (!shown) return;
      readAuthors(items);
      // The blocks between the index's newest and the live head, if any, are read by number.
      const newest = Math.max(...items.map((item) => item.number));
      const head = log.head();
      if (Number.isFinite(newest) && head !== null && head - newest > 1 && head - newest <= BLOCK_ROWS) {
        for (let n = newest + 1; n < head; n += 1) if (!log.get(n)) readBlock(n, { withHeader: true });
      }
    },
    SLOW_MS,
  );

  // ── the status row's other figures ──
  watch(
    'escrowStats',
    (record) => {
      apply('escrowStats', record, (data) => {
        setStat('agreements', formatInt(field(data, 'activeAgreementCount')));
        stamp('escrowStats', record);
      });
    },
    LIST_MS,
  );
  watch(
    'messagesSent',
    (record) => {
      apply('messagesSent', record, (data) => {
        setStat('messages', formatInt(field(data, 'total')));
        stamp('messagesSent', record);
      });
    },
    LIST_MS,
  );

  // ── disputes: opened less resolved, over the index ──
  const disputeRecords = { opened: null, resolved: null };
  function renderDisputes() {
    const { opened, resolved } = disputeRecords;
    if (!opened || !resolved) return;
    if (!opened.ok) {
      failed('disputesOpened', opened);
      return;
    }
    if (!resolved.ok) {
      failed('disputesResolved', resolved);
      return;
    }
    const result = openDisputes(opened.items, resolved.items);
    disputed = { ...result, complete: opened.complete && resolved.complete, read: opened.items.length };
    ok('disputesOpened', opened);
    ok('disputesResolved', resolved);
    setStat('disputes', formatInt(result.count), { caption: disputed.complete ? '' : `among the newest ${formatInt(disputed.read)} disputes read` });
    stamp('disputes', opened);
    renderAgents();
  }
  watchAll('disputesOpened', (record) => { disputeRecords.opened = record; renderDisputes(); }, SLOW_MS);
  watchAll('disputesResolved', (record) => { disputeRecords.resolved = record; renderDisputes(); }, SLOW_MS);

  // ── agents ──
  function renderAgents() {
    if (!agents?.ok) return;
    const head = best ?? (status ? field(status, 'chain.bestBlock') : null);
    const summary = agentSummary(agents.items, { head, grace: facts.heartbeatGrace, disputed: disputed.agents, recent: AGENT_ROWS });
    const partial = agents.complete ? '' : ` of the first ${formatInt(agents.items.length)} listed`;
    setStat('agents', formatInt(agents.total), { caption: `${formatInt(summary.operatorRun)} operator-run${partial}` });
    setStat('registered', formatInt(agents.total));
    setStat('active', formatInt(summary.active), { caption: `heartbeat within ${formatInt(facts.heartbeatGrace)} blocks${partial}` });
    // Until the dispute events are read the count is unknown, and its skeleton stays.
    if (disputed.count !== null) setStat('inDispute', formatInt(summary.inDispute), { caption: partial ? partial.replace(/^ of/, 'of') : '' });
    const context = { head, grace: facts.heartbeatGrace, blockMs: facts.blockMs };
    setRows('agents-table', summary.recent.length ? summary.recent.map((a) => tr(COLUMNS.agents, agentRow(a, context))).join('') : emptyRow(COLUMNS.agents, 'No agent is registered.'));
    stamp('agents', agents);
  }
  watchAll(
    'agents',
    (record) => {
      if (!record.ok) {
        failed('agents', record);
        return;
      }
      agents = record;
      ok('agents', record);
      renderAgents();
    },
    SLOW_MS,
    3,
  );

  // ── slashes in the index's newest hour ──
  function renderSlashes() {
    if (!slashRecord || !hour) return;
    apply('slashes', slashRecord, (data) => {
      const items = field(data, 'items');
      setStat('slashedHour', formatInt(sinceBlock(items, hour.since).length));
      stamp('slashes', slashRecord);
    });
  }
  watch('slashes', (record) => { slashRecord = record; renderSlashes(); }, SLOW_MS);

  // ── activity ──
  function renderActivity() {
    if (!activityRecord || !hour) return;
    apply('activity', activityRecord, (data) => {
      const items = field(data, 'items');
      const inHour = sinceBlock(items, hour.since).slice(0, ACTIVITY_ROWS);
      const t = now();
      const noun = KINDS.find((k) => k.value === activityKind)?.noun ?? 'agent events';
      setRows('activity-table', inHour.length ? inHour.map((item) => tr(COLUMNS.activity, activityRow(item, t))).join('') : emptyRow(COLUMNS.activity, activityEmpty(items, formatInt, noun)));
      stamp('activity', activityRecord);
    });
  }
  watch('activity', (record) => { activityRecord = record; renderActivity(); }, LIST_MS, activitySource(''));
  for (const chip of $$('#activity [data-filter]')) {
    chip.addEventListener('click', () => {
      activityKind = chip.getAttribute('data-filter') ?? '';
      for (const other of $$('#activity [data-filter]')) other.setAttribute('aria-pressed', other === chip ? 'true' : 'false');
      scheduler.replace('activity', activitySource(activityKind));
    });
  }

  // ── emissions ──
  watch(
    'supply',
    (record) => {
      apply('supply', record, (data) => {
        const symbol = field(data, 'tokenSymbol');
        const decimals = field(data, 'tokenDecimals');
        const issued = compactCmn(field(data, 'totalIssuancePlancks'), decimals);
        const cap = compactCmn(field(data, 'capPlancks'), decimals);
        setStat('issued', `${escapeHtml(issued.text)} ${escapeHtml(symbol)}`, { title: `${issued.full} ${symbol}` });
        setStat('cap', `${escapeHtml(cap.text)} ${escapeHtml(symbol)}`, { title: `${cap.full} ${symbol}` });
        stamp('supply', record);
      });
    },
    SLOW_MS,
  );
  watch(
    'emissions',
    (record) => {
      apply('emissions', record, (data) => {
        const last = compactCmn(field(data, 'lastEraEmissionPlancks'), facts.decimals);
        setStat('lastEra', `${escapeHtml(last.text)} ${escapeHtml(facts.symbol)}`, { title: `${last.full} ${facts.symbol}` });
        const params = field(data, 'parameters');
        const show = (key, html) => {
          const cell = $(`[data-param="${key}"]`);
          if (cell && cell.innerHTML !== html) cell.innerHTML = html;
        };
        const cmn = (key) => {
          const v = formatCmn(field(params, key), facts.decimals);
          return `<span title="${escapeHtml(`${v.full} ${facts.symbol}`)}">${escapeHtml(v.text)} ${escapeHtml(facts.symbol)}</span>`;
        };
        show('lastSettledEra', formatInt(field(data, 'lastSettledEra')));
        show('eraDurationBlocks', `${formatInt(field(params, 'eraDurationBlocks'))} blocks`);
        for (const key of ['initialEmissionPerEraPlancks', 'floorEmissionPerEraPlancks', 'targetEmissionPerAgentPlancks', 'minQualifyingVolumePlancks', 'unitVolumePlancks']) show(key, cmn(key));
        for (const key of ['velocityBonusBps', 'oracleBonusBps']) show(key, escapeHtml(formatBps(field(params, key))));
        stamp('emissions', record);
      });
    },
    SLOW_MS,
  );

  // ── the clock, and the tab's visibility ──
  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      scheduler.pause();
      paged.pause();
      socket.pause();
    } else {
      socket.resume();
      scheduler.resume();
      paged.resume();
      tick();
    }
  });
}

boot();
