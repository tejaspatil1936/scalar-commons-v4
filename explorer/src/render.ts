/**
 * Server-side HTML rendering, in the shared chrome.
 *
 * Pure functions from view model to markup: no chain access, no client-side
 * framework, one small script for the copy buttons. An explorer is read-only by
 * nature, so a page that arrives fully rendered is both the simplest thing that
 * works and the one that keeps working when a node is slow — there is no
 * second round trip to fail.
 *
 * Every page is built from the same components as the landing site
 * (`chrome-templates.ts` mirrors `landing/src/chrome/templates.mjs`), says in
 * plain words what each event and call is (`words.ts`), and names in its footer
 * what it read and when. Every interpolated value goes through `escapeHtml`,
 * because every value on these pages came off a public chain and is therefore
 * attacker-supplied.
 */

import {
  EXPLORER_ORIGIN,
  SITE_ORIGIN,
  address,
  badge,
  breadcrumb,
  button,
  callout,
  chips,
  copyButton,
  escapeHtml,
  formatInt,
  formatUtc,
  kvTable,
  page,
  pagination,
  searchField,
  stats,
  table,
  tabs,
} from './chrome-templates.js';
import { ACTIVITY_PAGE_SIZE } from './activity.js';
import { formatBalance, formatCmn, humanize, isoOf, relativeTime } from './format.js';
import { accountPath, activityPath, blockPath, blocksPath, extrinsicPath, SEARCH_PATH, type AccountTab, type ActivityKind, type BlockTab } from './routes.js';
import { heartbeatDecayed } from './types.js';
import type { AccountView, ActivityEntry, ActivityView, BlockView, BlocksView, ChainInfo, EventView, ExtrinsicSummary, ExtrinsicView, HistoryEntry, HomeView, ListPage, Outcome, Read } from './types.js';
import { CHIPS, accountFields, callWords, describeEvent, eventWords } from './words.js';

/**
 * The explorer's own layout rules: the vertical rhythm of a page of panels,
 * nothing else. No colour, no face, no size — every length is a --s-n step —
 * so the chrome test holds this sheet to the same scale as the chrome.
 */
const EXPLORER_CSS = `.x-page{padding-block:var(--s-6) var(--s-7)}.x-page>*+*{margin-top:var(--s-7)}.x-page>.sc-page-head{padding-top:0}.x-page time{white-space:nowrap}.x-panel{display:grid;gap:var(--s-4);align-content:start}.x-panel>.sc-between{margin:0}.sc-cols-2 .sc-table th,.sc-cols-2 .sc-table td{padding:var(--s-3)}`;

const SEARCH_PLACEHOLDER = 'Search by block number, block hash, extrinsic (block-index) or address';
const DESCRIPTION = 'Blocks, extrinsics, accounts and agent activity on the Scalar Commons testnet, read from the public node and the indexer.';

/** The search field every page carries (the home page first, the error pages last). */
const search = (value = ''): string => searchField({ action: SEARCH_PATH, placeholder: SEARCH_PLACEHOLDER, label: 'Search the chain', value });

interface Layout {
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly chain: ChainInfo | null;
  /** The render time; the footer's "Page built". */
  readonly renderedAt: string | null;
  /** The best block the page read; the footer's "from block". */
  readonly block: number | null;
  /** What the page read, for the footer caption. */
  readonly read: string | null;
  readonly description?: string;
}

/** Wraps a page body in the chrome: head, header (Explorer current), main, footer with the read caption. */
function layout({ title, path, body, chain, renderedAt, block, read, description = DESCRIPTION }: Layout): string {
  return page({
    title,
    description,
    path,
    current: 'explorer',
    site: SITE_ORIGIN,
    origin: EXPLORER_ORIGIN,
    assets: '/',
    cssHref: '/chrome.css',
    scripts: ['/chrome.js'],
    extraHead: `\n<style>${EXPLORER_CSS}</style>`,
    facts: chain ? { provenance: { specName: chain.specName, specVersion: chain.specVersion, readAtBlock: block } } : null,
    builtAt: renderedAt,
    body: `<div class="sc-container x-page">\n${body}\n</div>`,
    read,
  });
}

const nodeRead = (block: number): string => `Read from the node at block ${formatInt(block)}.`;
const indexerRead = (at: string | null | undefined): string => `List from the indexer, read at ${formatUtc(at)}.`;

// ── cells ────────────────────────────────────────────────────────────────────

/** A relative time with the absolute UTC time in the title; "no timestamp" when the block carries none. */
function timeCell(timestampMs: bigint | null, renderedAt: string | null): string {
  const iso = isoOf(timestampMs);
  if (iso === null) return '<span class="sc-muted">no timestamp</span>';
  const now = renderedAt ? new Date(renderedAt).getTime() : Date.now();
  return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(formatUtc(iso))}">${escapeHtml(relativeTime(Number(timestampMs), now))}</time>`;
}

const blockLink = (number: number): string => `<a class="sc-mono" href="${escapeHtml(blockPath({ kind: 'number', number }))}">${formatInt(number)}</a>`;
const extrinsicLink = (number: number, index: number): string => `<a class="sc-mono" href="${escapeHtml(extrinsicPath({ kind: 'number', number }, index))}">${formatInt(number)}-${index}</a>`;
const hashCell = (hash: string, href: string | null = null): string => address(hash, { href, head: 8, tail: 6 });
const authorCell = (author: string | null): string => (author ? address(author, { href: accountPath(author) }) : '<span class="sc-muted">not in the pre-digest</span>');
const finalityBadge = (final: boolean | null): string => (final === null ? '<span class="sc-muted">unknown</span>' : badge(final ? 'Finalized' : 'Pending'));

/** A planck amount at two decimals, the full value in the title. */
const cmn = (plancks: bigint, chain: ChainInfo): string =>
  `<span title="${escapeHtml(formatBalance(plancks, chain.tokenDecimals, chain.tokenSymbol))}">${escapeHtml(formatCmn(plancks, chain.tokenDecimals, chain.tokenSymbol))}</span>`;

/** The call in words, with the raw `pallet.call` beside it for anyone who wants it. */
const callCell = (section: string, method: string): string =>
  `${escapeHtml(callWords(section, method))} <span class="sc-caption sc-mono">${escapeHtml(`${section}.${method}`)}</span>`;

/** The event in words (raw name in the title), with its status badge when it has one. */
function eventCell(section: string, method: string): string {
  const words = eventWords(section, method);
  const raw = `${section}.${method}`;
  return `<span title="${escapeHtml(raw)}">${escapeHtml(words.label)}</span>${words.badge ? ` ${badge(words.badge)}` : ''}`;
}

/** Renders a dispatch outcome as its badge, keeping "unknown" visibly distinct from "success". */
function outcomeCell(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'success':
      return badge('Succeeded');
    case 'failed':
      return `${badge('Failed')} <span class="sc-caption sc-mono">${escapeHtml(outcome.reason)}</span>`;
    case 'unknown':
      return '<span class="sc-muted">not recorded</span>';
  }
}

/**
 * Renders who signed an extrinsic.
 *
 * `signer` is only set when the extrinsic's address decoded to an `AccountId`,
 * which `MultiAddress::Index`, `::Raw` and `::Address20` never do. Those are
 * still signed extrinsics, so the decision is made on `isSigned` — the field
 * the chain itself reports — and not on whether there happened to be an account
 * to link to. Deciding on the link alone would print "unsigned" over a
 * signature the node did report.
 */
function signerCell(isSigned: boolean, signer: string | null): string {
  if (signer !== null) return address(signer, { href: accountPath(signer) });
  return isSigned ? '<span class="sc-muted">signed (its address is not an AccountId)</span>' : '<span class="sc-muted">unsigned (inherent)</span>';
}

/** A failed read as the error callout the brief asks for: the plain cause, never a blank or a zero. */
const unavailable = (what: string, reason: string): string => callout({ variant: 'warning', body: `${escapeHtml(what)} ${escapeHtml(reason)}` });

/** The agent-address filter form the activity page keeps. */
function agentFilter(agent: string | null, kind: ActivityKind | null): string {
  return `<form class="sc-search-row" method="get" action="${escapeHtml(activityPath())}"><label class="sc-search"><span class="sc-sr">Filter by agent address</span><input class="sc-input" type="text" name="agent" value="${escapeHtml(agent ?? '')}" placeholder="Filter by agent address (SS58)" autocomplete="off" spellcheck="false"></label>${kind ? `<input type="hidden" name="kind" value="${escapeHtml(kind)}">` : ''}<button class="sc-btn sc-btn-secondary" type="submit">Filter</button></form>`;
}

/** The shared activity row: Time · Block · Event · Agent(s) · Details. */
function activityRow(entry: ActivityEntry, chain: ChainInfo, renderedAt: string | null): string[] {
  const agents = entry.agents.length === 0 ? '<span class="sc-muted">none named</span>' : entry.agents.map((a) => address(a, { href: accountPath(a) })).join('<br>');
  const details = describeEvent(entry.section, entry.method, entry.fields, { decimals: chain.tokenDecimals, symbol: chain.tokenSymbol }, { showAccounts: false });
  return [timeCell(entry.timestampMs, renderedAt), blockLink(entry.blockNumber), eventCell(entry.section, entry.method), agents, details];
}

const ACTIVITY_COLUMNS = [{ label: 'Time' }, { label: 'Block' }, { label: 'Event' }, { label: 'Agents' }, { label: 'Details' }];

const pager = (list: ListPage<unknown>, href: (offset: number) => string): string =>
  pagination({
    prevHref: list.offset > 0 ? href(Math.max(0, list.offset - list.limit)) : null,
    nextHref: list.offset + list.items.length < list.total ? href(list.offset + list.limit) : null,
    from: list.total === 0 ? 0 : list.offset + 1,
    to: Math.min(list.total, list.offset + list.items.length),
    total: list.total,
  });

// ── home ─────────────────────────────────────────────────────────────────────

/** The index page: the search field, four stats, the latest blocks and activity side by side, the chain facts. */
export function renderHome(view: HomeView): string {
  const r = view.readings;
  const renderedAt = r?.renderedAt ?? null;
  const finalized = r?.finalized.value?.number ?? null;
  const chain = view.chain;

  const statValue = <T>(read: Read<T> | undefined, format: (value: T) => string): { value: string; caption: string | null } => {
    if (read === undefined) return { value: 'Unavailable', caption: 'Not read in this view.' };
    if (read.value === null) return { value: 'Unavailable', caption: escapeHtml(read.reason ?? 'Not read.') };
    return { value: format(read.value), caption: null };
  };
  const agents = statValue(view.agents, (n) => formatInt(n));
  const emission = statValue(view.emission, (e) => cmn(e.lastEraEmission, chain));
  const statsHtml = stats(
    [
      { label: 'Block height', value: formatInt(view.head.number) },
      { label: 'Finalized', value: finalized === null ? 'Unavailable' : formatInt(finalized), caption: finalized === null ? escapeHtml(r?.finalized.reason ?? 'Not read.') : null },
      { label: 'Registered agents', value: agents.value, caption: agents.caption },
      { label: 'Last era emission', value: emission.value, caption: emission.caption ?? (view.emission?.value?.lastSettledEra !== null && view.emission?.value?.lastSettledEra !== undefined ? `era ${formatInt(view.emission.value.lastSettledEra)}` : null) },
    ],
    { label: 'Network right now' },
  );

  const recent = r?.recent;
  const blocksTable =
    recent === undefined || recent.value === null
      ? unavailable('The latest blocks could not be read from the node.', recent?.reason ?? '')
      : table({
          columns: [{ label: 'Block' }, { label: 'Age' }, { label: 'Author' }, { label: 'Finalized' }],
          rows: recent.value.map((b) => [blockLink(b.number), timeCell(b.timestampMs, renderedAt), authorCell(b.author), finalityBadge(finalized === null ? null : b.number <= finalized)]),
          empty: 'No blocks were read.',
          caption: 'Latest blocks',
        });
  const activity = view.activity;
  const activityTable =
    activity === undefined
      ? unavailable('Latest activity was not read in this view.', '')
      : activity.value === null
        ? unavailable('The latest activity could not be read.', activity.reason)
        : table({
            columns: [{ label: 'Time' }, { label: 'Event' }, { label: 'Agent' }],
            rows: activity.value.map((e) => [timeCell(e.timestampMs, renderedAt), eventCell(e.section, e.method), e.agents[0] ? address(e.agents[0], { href: accountPath(e.agents[0]) }) : '<span class="sc-muted">none named</span>']),
            empty: 'No agent events in the index yet.',
            caption: 'Latest activity',
          });

  const panel = (title: string, href: string, body: string): string =>
    `<section class="x-panel" aria-label="${escapeHtml(title)}"><div class="sc-between"><h2 class="sc-h3">${escapeHtml(title)}</h2>${button({ text: 'View all', href, variant: 'text' })}</div>${body}</section>`;

  const about = kvTable(
    [
      ['Chain name', escapeHtml(chain.chain)],
      ['Runtime', `${escapeHtml(chain.specName)} ${escapeHtml(String(chain.specVersion))}`],
      ['Token', `${escapeHtml(chain.tokenSymbol)}, ${formatInt(chain.tokenDecimals)} decimals`],
      ['SS58 prefix', formatInt(chain.ss58Format)],
      ['Genesis hash', `<span class="sc-full">${escapeHtml(chain.genesisHash)}</span> ${copyButton(chain.genesisHash)}`],
      ...(chain.nodeVersion ? [['Node version', escapeHtml(chain.nodeVersion)] as const] : []),
    ],
    { caption: 'About this chain' },
  );

  const body = `${search()}
<section class="x-panel" aria-labelledby="now-h"><h1 class="sc-h2" id="now-h">Scalar Commons testnet</h1>${statsHtml}</section>
<div class="sc-cols-2">
${panel('Latest blocks', blocksPath(), blocksTable)}
${panel('Latest activity', activityPath(), activityTable)}
</div>
<section class="x-panel" aria-labelledby="about-h"><h2 class="sc-h3" id="about-h">About this chain</h2>${about}</section>`;

  return layout({
    title: 'Explorer',
    path: '/',
    body,
    chain,
    renderedAt,
    block: view.head.number,
    read: `${nodeRead(view.head.number)} ${view.indexerReadAt ? `Lists from the indexer, read at ${formatUtc(view.indexerReadAt)}.` : ''}`.trim(),
  });
}

// ── blocks ───────────────────────────────────────────────────────────────────

/** The paginated block list: 25 a page from the indexer, authors from the node. */
export function renderBlocks(view: BlocksView): string {
  const { page: list, renderedAt } = view;
  const rows = list.items.map((b) => [
    blockLink(b.number),
    timeCell(b.timestampMs, renderedAt),
    hashCell(b.hash, blockPath({ kind: 'hash', hash: b.hash })),
    authorCell(b.author),
    formatInt(b.extrinsicCount),
    formatInt(b.eventCount),
    finalityBadge(view.finalized === null ? null : b.number <= view.finalized),
  ]);
  const body = `<div class="sc-page-head"><h1 class="sc-h1">Blocks</h1><p class="sc-lead">Finalized blocks the indexer holds, newest first.</p></div>
${table({
  columns: [{ label: 'Block' }, { label: 'Age' }, { label: 'Hash' }, { label: 'Author' }, { label: 'Extrinsics', align: 'right' }, { label: 'Events', align: 'right' }, { label: 'Finalized' }],
  rows,
  empty: 'The indexer holds no blocks yet.',
  caption: 'Blocks',
})}
${pager(list, blocksPath)}`;
  return layout({ title: 'Blocks', path: blocksPath(list.offset), body, chain: view.chain, renderedAt, block: view.best, read: `${indexerRead(renderedAt)} Authors from the node at block ${formatInt(view.best)}.` });
}

// ── block ────────────────────────────────────────────────────────────────────

/** A block: key/value facts, then its extrinsics or its events, the tab in the URL. */
export function renderBlock(view: BlockView, chain: ChainInfo, tab: BlockTab = 'extrinsics'): string {
  const d = view.detail;
  const renderedAt = d?.renderedAt ?? null;
  const best = d?.best ?? view.number;
  const final = d?.finalized.value ?? null;
  const ref = { kind: 'number' as const, number: view.number };
  const events = d?.events ?? view.extrinsics.flatMap((extrinsic) => (extrinsic.events ?? []).map((event) => ({ ...event, extrinsicIndex: extrinsic.index })));
  const iso = isoOf(view.timestampMs);

  const facts = kvTable(
    [
      ['Number', formatInt(view.number)],
      ['Hash', `<span class="sc-full">${escapeHtml(view.hash)}</span> ${copyButton(view.hash)}`],
      ['Parent', view.number === 0 ? '<span class="sc-muted">none (genesis)</span>' : `<a class="sc-full" href="${escapeHtml(blockPath({ kind: 'hash', hash: view.parentHash }))}">${escapeHtml(view.parentHash)}</a>`],
      ['Timestamp', iso === null ? '<span class="sc-muted">no timestamp</span>' : `${escapeHtml(formatUtc(iso))} (${timeCell(view.timestampMs, renderedAt)})`],
      ['Author', d === undefined ? '<span class="sc-muted">not read</span>' : authorCell(d.author.value)],
      ['Status', finalityBadge(final)],
      ['Extrinsics', formatInt(view.extrinsics.length)],
      ['Events', formatInt(events.length)],
      ['State root', `<span class="sc-full">${escapeHtml(view.stateRoot)}</span>`],
    ],
    { caption: `Block ${formatInt(view.number)}` },
  );

  const extrinsicsTable = table({
    columns: [{ label: 'Extrinsic' }, { label: 'Call' }, { label: 'Signer' }, { label: 'Result' }],
    rows: view.extrinsics.map((e: ExtrinsicSummary) => [extrinsicLink(view.number, e.index), callCell(e.section, e.method), signerCell(e.isSigned, e.signer), outcomeCell(e.outcome)]),
    empty: 'This block has no extrinsics.',
    caption: 'Extrinsics',
  });
  const eventsTable = table({
    columns: [{ label: 'Index' }, { label: 'Event' }, { label: 'Details' }, { label: 'Extrinsic' }],
    rows: events.map((e) => [
      formatInt(e.index),
      eventCell(e.section, e.method),
      describeEvent(e.section, e.method, e.fields, { decimals: chain.tokenDecimals, symbol: chain.tokenSymbol }),
      e.extrinsicIndex === null ? '<span class="sc-muted">block hook</span>' : extrinsicLink(view.number, e.extrinsicIndex),
    ]),
    empty: d === undefined && view.extrinsics.every((e) => e.events === undefined) ? 'Events were not read in this view.' : 'No events were recorded in this block.',
    caption: 'Events',
  });

  const nav = `<div class="sc-actions">${
    view.number > 0 ? button({ text: 'Previous block', href: blockPath({ kind: 'number', number: view.number - 1 }), variant: 'secondary' }) : ''
  }${view.number < best ? button({ text: 'Next block', href: blockPath({ kind: 'number', number: view.number + 1 }), variant: 'secondary' }) : ''}</div>`;

  const body = `${breadcrumb([{ text: 'Explorer', href: '/' }, { text: `Block ${formatInt(view.number)}` }])}
<div class="sc-page-head"><h1 class="sc-h1">Block ${formatInt(view.number)}</h1>${nav}</div>
${facts}
<section class="x-panel">${tabs(
    [
      { label: `Extrinsics (${formatInt(view.extrinsics.length)})`, href: blockPath(ref, 'extrinsics'), current: tab === 'extrinsics' },
      { label: `Events (${formatInt(events.length)})`, href: blockPath(ref, 'events'), current: tab === 'events' },
    ],
    { label: 'Block contents' },
  )}${tab === 'extrinsics' ? extrinsicsTable : eventsTable}</section>`;

  return layout({ title: `Block ${formatInt(view.number)}`, path: blockPath(ref, tab), body, chain, renderedAt, block: best, read: nodeRead(best) });
}

// ── extrinsic ────────────────────────────────────────────────────────────────

/** The fee the runtime charged, read from the `transactionPayment.TransactionFeePaid` event; null when the extrinsic paid none or the event is absent. */
export function feeOf(events: readonly EventView[]): bigint | null {
  for (const event of events) {
    if (event.section !== 'transactionPayment' || event.method !== 'TransactionFeePaid') continue;
    const field = event.fields.find((f) => f.name === 'actualFee' || f.name === 'actual_fee');
    if (field && /^\d[\d,]*$/.test(field.value)) return BigInt(field.value.replace(/,/g, ''));
  }
  return null;
}

/** One extrinsic: key/value facts (the call in words and raw), then its arguments and events. */
export function renderExtrinsic(view: ExtrinsicView, chain: ChainInfo): string {
  const renderedAt = view.renderedAt ?? null;
  const id = `${formatInt(view.block.number)}-${view.index}`;
  const fee = feeOf(view.events);
  const token = { decimals: chain.tokenDecimals, symbol: chain.tokenSymbol };

  const facts = kvTable(
    [
      ['Block', blockLink(view.block.number)],
      ['Index', formatInt(view.index)],
      ['Hash', `<span class="sc-full">${escapeHtml(view.hash)}</span> ${copyButton(view.hash)}`],
      ['Signer', signerCell(view.isSigned, view.signer)],
      ['Call', callCell(view.section, view.method)],
      ['Result', outcomeCell(view.outcome)],
      ...(fee !== null ? [['Fee', cmn(fee, chain)] as const] : []),
      ...(view.tip !== null && view.tip > 0n ? [['Tip', cmn(view.tip, chain)] as const] : []),
      ...(view.nonce !== null ? [['Nonce', formatInt(view.nonce)] as const] : []),
      ['Size', `${formatInt(view.lengthBytes)} bytes`],
    ],
    { caption: `Extrinsic ${id}` },
  );

  const args = table({
    columns: [{ label: 'Argument' }, { label: 'Type' }, { label: 'Value' }],
    rows: view.args.map((arg) => [escapeHtml(humanize(arg.name)), `<span class="sc-mono">${escapeHtml(arg.type)}</span>`, `<span class="sc-full">${escapeHtml(arg.value)}</span>`]),
    empty: 'This call takes no arguments.',
    caption: 'Arguments',
  });
  const events = table({
    columns: [{ label: 'Index' }, { label: 'Event' }, { label: 'Details' }],
    rows: view.events.map((e) => [formatInt(e.index), eventCell(e.section, e.method), describeEvent(e.section, e.method, e.fields, token)]),
    empty: 'No events were recorded for this extrinsic.',
    caption: 'Events',
  });

  const body = `${breadcrumb([{ text: 'Explorer', href: '/' }, { text: `Block ${formatInt(view.block.number)}`, href: blockPath({ kind: 'number', number: view.block.number }) }, { text: `Extrinsic ${id}` }])}
<div class="sc-page-head"><h1 class="sc-h1">Extrinsic ${id}</h1><p class="sc-lead">${escapeHtml(callWords(view.section, view.method))}.</p></div>
${facts}
<section class="x-panel"><h2 class="sc-h3">Arguments</h2>${args}</section>
<section class="x-panel"><h2 class="sc-h3">Events</h2>${events}</section>`;

  return layout({ title: `Extrinsic ${id}`, path: extrinsicPath({ kind: 'number', number: view.block.number }, view.index), body, chain, renderedAt, block: view.block.number, read: nodeRead(view.block.number) });
}

// ── account ──────────────────────────────────────────────────────────────────

/** An account: the full address, its balances, its agent record when it has one, and its history in two tabs. */
export function renderAccount(view: AccountView, chain: ChainInfo): string {
  const roles = view.roles;
  const renderedAt = roles?.renderedAt ?? null;
  const tab: AccountTab = view.tab ?? 'extrinsics';
  const token = { decimals: chain.tokenDecimals, symbol: chain.tokenSymbol };

  // A key/value table rather than a stat row: a genesis-scale balance
  // ("1,000,051,912.36 CMN") does not fit a quarter of the container at the
  // stat size, and a figure that spills its cell is the one layout fault the
  // check forbids. The full planck value is in each title.
  const balances = kvTable(
    [
      ['Free balance', cmn(view.free, chain)],
      ['Reserved', cmn(view.reserved, chain)],
      ['Total', `${cmn(view.free + view.reserved, chain)} <span class="sc-caption">free + reserved</span>`],
      ['Transactions sent', formatInt(view.nonce)],
    ],
    { caption: 'Balances' },
  );

  // The Agent card: the indexer's record when it answered, the node's own reads otherwise.
  const record = view.agent?.value ?? null;
  const nodeName = roles?.agentName.value ?? null;
  const nodeStake = roles?.agentStake.value ?? null;
  const isAgent = record !== null || nodeName !== null || nodeStake !== null;
  let agentCard = '';
  if (isAgent) {
    const name = record?.name ?? nodeName;
    const heartbeat = roles?.heartbeat?.value ?? null;
    const lastHeartbeat = record?.lastHeartbeatBlock ?? heartbeat?.lastHeartbeat ?? null;
    const operator = name !== null && name.startsWith('swarm-');
    const status =
      record?.unstakeAtBlock !== null && record?.unstakeAtBlock !== undefined
        ? `${badge('Pending')} <span class="sc-caption">unstaking at block ${formatInt(record.unstakeAtBlock)}</span>`
        : heartbeat === null
          ? '<span class="sc-muted">not read</span>'
          : heartbeatDecayed(heartbeat)
            ? `${badge('Stale')} <span class="sc-caption">no heartbeat within the grace period of ${formatInt(heartbeat.grace)} blocks</span>`
            : badge('Active');
    const stake = record?.stakePlancks ?? nodeStake;
    const rows: (readonly [string, string])[] = [
      ['Name', name === null ? '<span class="sc-muted">no name on chain</span>' : `${escapeHtml(name)}${operator ? ` ${badge('Operator-run')}` : ''}`],
      ['Status', status],
      ['Stake', stake === null ? '<span class="sc-muted">none</span>' : cmn(stake, chain)],
      ...(record ? [['Registered at', record.registeredAtBlock === 0 ? 'genesis' : blockLink(record.registeredAtBlock)] as const] : []),
      [
        'Last heartbeat',
        lastHeartbeat === null
          ? '<span class="sc-muted">none</span>'
          : `${blockLink(lastHeartbeat)} <span class="sc-caption">${formatInt(Math.max(0, view.at.number - lastHeartbeat))} blocks ago</span>`,
      ],
      ...(record ? [['Agreements', `${formatInt(record.completedAgreements)} completed, ${formatInt(record.activeEscrowCount)} open`] as const] : []),
    ];
    agentCard = `<article class="sc-card" aria-labelledby="agent-h"><h3 id="agent-h">Agent</h3>${kvTable(rows, { caption: 'Agent' })}<div>${button({ text: 'Agent activity', href: activityPath(view.address), variant: 'text' })}</div></article>`;
  } else if (view.agent !== undefined && view.agent.value === null && view.agent.reason !== null) {
    agentCard = unavailable('The agent record could not be read from the indexer.', view.agent.reason);
  }

  const tabsHtml = tabs(
    [
      { label: 'Extrinsics', href: accountPath(view.address), current: tab === 'extrinsics' },
      { label: 'Activity', href: accountPath(view.address, { tab: 'activity' }), current: tab === 'activity' },
    ],
    { label: 'Account history' },
  );
  let list: string;
  if (tab === 'extrinsics') {
    const read = view.extrinsics;
    list =
      read === undefined
        ? unavailable('The extrinsics were not read in this view.', '')
        : read.value === null
          ? unavailable('The extrinsics could not be read from the indexer.', read.reason)
          : `${table({
              columns: [{ label: 'Extrinsic' }, { label: 'Block' }, { label: 'Call' }, { label: 'Result' }],
              rows: read.value.items.map((h: HistoryEntry) => [extrinsicLink(h.blockNumber, h.index), blockLink(h.blockNumber), callCell(h.section, h.method), h.success === null ? '<span class="sc-muted">not recorded</span>' : badge(h.success ? 'Succeeded' : 'Failed')]),
              empty: 'This account has signed no extrinsics in the indexed history.',
              caption: 'Extrinsics',
            })}${pager(read.value, (offset) => accountPath(view.address, { tab: 'extrinsics', offset }))}`;
  } else {
    const read = view.events;
    list =
      read === undefined
        ? unavailable('The activity was not read in this view.', '')
        : read.value === null
          ? unavailable('The activity could not be read from the indexer.', read.reason)
          : `${table({
              columns: [{ label: 'Time' }, { label: 'Block' }, { label: 'Event' }, { label: 'Details' }],
              rows: read.value.items.map((e) => [
                timeCell(e.timestampMs, renderedAt),
                e.extrinsicIndex === null ? blockLink(e.blockNumber) : extrinsicLink(e.blockNumber, e.extrinsicIndex),
                eventCell(e.section, e.method),
                describeEvent(e.section, e.method, e.fields.filter((f) => f.value !== view.address), token),
              ]),
              empty: 'No events name this account in the indexed history.',
              caption: 'Activity',
            })}${pager(read.value, (offset) => accountPath(view.address, { tab: 'activity', offset }))}`;
  }

  const body = `${breadcrumb([{ text: 'Explorer', href: '/' }, { text: 'Account' }])}
<div class="sc-page-head"><h1 class="sc-h1">Account</h1><p class="sc-full">${escapeHtml(view.address)} ${copyButton(view.address, 'Copy address')}</p></div>
${balances}
${agentCard}
<section class="x-panel">${tabsHtml}${list}</section>`;

  return layout({
    title: 'Account',
    path: accountPath(view.address, { tab, offset: tab === 'extrinsics' ? (view.extrinsics?.value?.offset ?? 0) : (view.events?.value?.offset ?? 0) }),
    body,
    chain,
    renderedAt,
    block: view.at.number,
    read: `${nodeRead(view.at.number)} List from the indexer.`,
  });
}

// ── activity ─────────────────────────────────────────────────────────────────

/** The agent-activity feed on the shared table: Time · Block · Event · Agents · Details, filter chips, the agent filter, 25 a page. */
export function renderActivity(view: ActivityView, chain: ChainInfo): string {
  const renderedAt = view.readAt ?? null;
  const kind = (view.filter as ActivityKind | null) ?? null;
  const filterChips = chips(
    CHIPS.map((c) => ({ label: c.label, href: activityPath(view.agent, 0, c.kind), current: c.kind === kind })),
    { label: 'Filter by kind' },
  );
  const intro =
    view.agent === null
      ? `Agent events, newest first.${view.historyFrom === null ? '' : ` History reaches back to block ${formatInt(view.historyFrom)}.`}`
      : `Events naming ${address(view.agent, { href: accountPath(view.agent) })}, newest first. <a href="${escapeHtml(activityPath(null, 0, kind))}">Show every agent</a>.`;
  const list: ListPage<ActivityEntry> = { total: view.total, offset: view.offset, limit: view.limit, items: view.entries };
  const empty = view.agent === null ? (view.offset > 0 ? 'No agent events this far back.' : 'No agent events in the index yet.') : 'No events name this agent in the indexed history.';

  const body = `<div class="sc-page-head"><h1 class="sc-h1">Activity</h1><p class="sc-lead">${intro}</p></div>
<section class="x-panel">${filterChips}${agentFilter(view.agent, kind)}${table({ columns: ACTIVITY_COLUMNS, rows: view.entries.map((e) => activityRow(e, chain, renderedAt)), empty, caption: 'Agent activity' })}${pager(list, (offset) => activityPath(view.agent, offset, kind))}</section>`;

  return layout({ title: 'Activity', path: activityPath(view.agent, view.offset, kind), body, chain, renderedAt, block: view.best ?? null, read: indexerRead(renderedAt) });
}

// ── search miss and errors ───────────────────────────────────────────────────

/** "Nothing found for '…'": the field again and the four formats it accepts, with examples from the chain. */
export function renderSearchMiss(query: string, chain: ChainInfo, best: number, renderedAt: string): string {
  const body = `<div class="sc-page-head"><h1 class="sc-h1">Nothing found for ‘${escapeHtml(query)}’</h1><p class="sc-lead">Search by one of these.</p></div>
<ul class="sc-prose sc-stack">
<li>A block number, such as <span class="sc-mono">${formatInt(best)}</span></li>
<li>A block hash: <span class="sc-mono">0x</span> and 64 hexadecimal characters</li>
<li>An extrinsic as block-index, such as <span class="sc-mono">${formatInt(best)}-0</span></li>
<li>An account address (SS58)</li>
</ul>
${search(query)}`;
  return layout({ title: 'Nothing found', path: SEARCH_PATH, body, chain, renderedAt, block: best, read: nodeRead(best) });
}

const ERROR_TITLES: Readonly<Record<number, string>> = { 400: 'That is not something this explorer can look up', 404: 'Page not found', 502: 'Not available right now', 500: 'Not available right now' };

/**
 * An error page: a plain title, one sentence, the search field. The sentence
 * is written by the server from what it knows, never from an upstream error's
 * text, so it carries no internal address and no stack trace.
 */
export function renderError(status: number, sentence: string, chain: ChainInfo | null): string {
  const body = `<div class="sc-page-head"><h1 class="sc-h1">${escapeHtml(ERROR_TITLES[status] ?? 'Something went wrong')}</h1><p class="sc-lead">${escapeHtml(sentence)}</p></div>
${search()}
<p>${button({ text: 'Explorer home', href: '/', variant: 'text' })}</p>`;
  return layout({ title: ERROR_TITLES[status] ?? `Error ${status}`, path: '/', body, chain, renderedAt: null, block: null, read: null, description: 'Scalar Commons explorer.' });
}

export { ACTIVITY_PAGE_SIZE };
