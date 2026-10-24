/**
 * HTML rendering for every explorer page (SITE-REDESIGN.md §5.5).
 *
 * Pure: view model in, string out. Every page is built from the shared chrome
 * (`chrome-templates.ts`, the mirror of `landing/src/chrome/templates.mjs`) and
 * nothing else: the same header (Explorer current), the same footer, the same
 * tables, stats, badges, tabs and search field as the site. Nothing here types
 * a figure — every count, date, hash and amount is a parameter that came from
 * the node or the indexer, and a value that could not be read is said to be
 * unavailable or marked Stale, never shown as zero.
 */

import {
  CHAIN_NAME,
  address,
  badge,
  breadcrumb,
  button,
  callout,
  chips,
  escapeHtml,
  formatInt,
  formatUtc,
  icon,
  kvTable,
  page,
  pagination,
  searchField,
  stats,
  table,
  tabs,
  truncateMiddle,
  type FooterFacts,
  type StatItem,
} from './chrome-templates.js';
import { COPY_SCRIPT } from './favicon.js';
import { accountPath, activityPath, blockPath, blocksPath, extrinsicPath, searchPath } from './routes.js';
import type { AccountView, ActivityEntry, BlockView, ChainInfo, EventView, ExtrinsicView, HistoryEntry } from './types.js';

/** The page size of every paginated explorer list. */
export const PAGE_SIZE = 25;

/** A value read for this page; when the read failed and an earlier value is kept, `stale` says so. */
export interface Live<T> {
  readonly value: T | null;
  readonly stale: boolean;
  /** When the value was read (ISO). */
  readonly at: string | null;
  /** The plain cause when the latest read failed. */
  readonly reason: string | null;
}

/** What every page knows about the request it answers. */
export interface PageContext {
  readonly info: ChainInfo;
  /** When the page was rendered (ISO). */
  readonly renderedAt: string;
  /** The best block the page was read at, when it read one. */
  readonly block: number | null;
}

export interface BlockRow {
  readonly number: number;
  readonly hash: string;
  readonly timestampMs: number | null;
  readonly author: string | null;
  readonly extrinsics: number | null;
  readonly events: number | null;
}

// ── words and numbers ────────────────────────────────────────────────────────

const PLACEHOLDER = 'Search by block number, block hash, extrinsic (block-index) or address';
const searchBox = (value = ''): string => searchField({ action: '/search', placeholder: PLACEHOLDER, label: 'Search the explorer', value });

/** "4 s ago", "4 min ago", "3 h ago"; a day or older is the UTC date. The absolute UTC time goes in `title`. */
export function relativeTime(ms: number | bigint | null, nowIso: string): string {
  if (ms === null) return '<span class="sc-muted">Time not recorded</span>';
  const at = Number(ms);
  const diff = Math.max(0, Math.round((Date.parse(nowIso) - at) / 1000));
  const text = diff < 60 ? `${diff} s ago` : diff < 3600 ? `${Math.floor(diff / 60)} min ago` : diff < 86_400 ? `${Math.floor(diff / 3600)} h ago` : formatUtc(at);
  return `<time datetime="${escapeHtml(new Date(at).toISOString())}" title="${escapeHtml(formatUtc(at))}">${escapeHtml(text)}</time>`;
}

/** Plancks → "1,084.51 CMN" with the full planck value in `title`. */
export function amount(plancks: bigint, info: ChainInfo): string {
  const scale = 10n ** BigInt(info.tokenDecimals);
  const cents = (plancks * 100n + scale / 2n) / scale;
  const whole = cents / 100n;
  const frac = String(cents % 100n).padStart(2, '0');
  const title = escapeHtml(`${formatInt(plancks)} plancks`);
  // A non-zero amount that rounds to nothing says so, rather than reading as zero.
  if (cents === 0n && plancks > 0n) return `<span class="sc-num" title="${title}">&lt; ${formatInt(whole)}.${String(1).padStart(2, '0')} ${escapeHtml(info.tokenSymbol)}</span>`;
  return `<span class="sc-num" title="${title}">${formatInt(whole)}.${frac} ${escapeHtml(info.tokenSymbol)}</span>`;
}

/** "sendHeartbeat" / "send_heartbeat" / "HeartbeatSent" → "send heartbeat" / "heartbeat sent". */
export function words(identifier: string): string {
  return identifier
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}
const sentence = (text: string): string => (text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

/** Events whose plain name is not just their identifier in words. */
const EVENT_WORDS: Readonly<Record<string, string>> = {
  'agents.AgentRegistered': 'Agent registered',
  'agents.HeartbeatSent': 'Heartbeat sent',
  'agents.SlashExecuted': 'Agent slashed',
  'escrow.AgreementCreated': 'Agreement opened',
  'escrow.DisputeOpened': 'Dispute opened',
  'escrow.DisputeResolved': 'Dispute resolved',
  'oracle.OracleResponseSubmitted': 'Oracle answer submitted',
  'oracle.BatchResponseSubmitted': 'Oracle answers submitted',
};
/** An event in plain words: "Agreement opened", not `escrow.AgreementCreated`. */
export const eventWords = (section: string, method: string): string => EVENT_WORDS[`${section}.${method}`] ?? sentence(words(method));
/** A call in plain words: "Agents: send heartbeat". */
export const callWords = (section: string, method: string): string => `${sentence(words(section))}: ${words(method)}`;

/** The badge an activity row carries: Dispute or Slashed, else none. */
function activityBadge(entry: ActivityEntry): string {
  if (entry.kind === 'dispute' || entry.method.startsWith('Dispute')) return ` ${badge('Dispute')}`;
  if (entry.kind === 'slash' || entry.method.startsWith('Slash')) return ` ${badge('Slashed')}`;
  return '';
}

const mono = (text: string, title: string | null = null): string => `<span class="sc-mono"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
const blockLink = (n: number): string => `<a class="sc-mono" href="${blockPath({ kind: 'number', number: n })}">${formatInt(n)}</a>`;
const accountLink = (a: string | null): string => (a ? address(a, { href: accountPath(a) }) : '<span class="sc-muted">Not recorded</span>');
const muted = (text: string): string => `<span class="sc-muted">${escapeHtml(text)}</span>`;

/** The warning callout for reads that failed, with the plain cause and the time of the values kept. */
function staleCallout(reads: readonly { name: string; live: Live<unknown> }[]): string {
  const failed = reads.filter((r) => r.live.reason !== null);
  if (failed.length === 0) return '';
  const lines = failed.map((r) =>
    r.live.value !== null && r.live.at !== null
      ? `${escapeHtml(r.live.reason ?? '')} ${escapeHtml(r.name)}: values are from ${escapeHtml(formatUtc(r.live.at))}.`
      : `${escapeHtml(r.live.reason ?? '')} ${escapeHtml(r.name)} cannot be shown.`,
  );
  return `<div class="ex-block">${callout({ variant: 'warning', body: lines.join('<br>') })}</div>`;
}

/** A stat whose value came from a Live read: the value, or "Unavailable"; a Stale badge when kept from an earlier read. */
function liveStat<T>(label: string, live: Live<T>, show: (v: T) => string, caption: string | null = null): StatItem {
  if (live.value === null) return { label, value: muted('Unavailable'), caption };
  return { label, value: show(live.value), caption: live.stale ? badge('Stale') : caption };
}

function facts(ctx: PageContext): FooterFacts {
  return { specName: ctx.info.specName, specVersion: ctx.info.specVersion, block: ctx.block };
}

/** "List from the indexer, 3 s ago." */
const indexerRead = (at: string | null, now: string): string => {
  if (at === null) return 'The indexer did not answer for this page.';
  const s = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 1000));
  return `List from the indexer, ${s} s ago.`;
};
const nodeRead = (ctx: PageContext): string => (ctx.block === null ? 'Read from the node.' : `Read from the node at block ${formatInt(ctx.block)}.`);

function layout(ctx: PageContext, opts: { title: string; description: string; path: string; read: string; body: string }): string {
  return page({
    title: opts.title,
    description: opts.description,
    path: opts.path,
    facts: facts(ctx),
    renderedAt: ctx.renderedAt,
    read: opts.read,
    body: opts.body,
    script: COPY_SCRIPT,
  });
}

const pageHead = (title: string, lead: string | null = null, crumbs = ''): string =>
  `<div class="sc-page-head">${crumbs}<h1 class="sc-h1">${escapeHtml(title)}</h1>${lead ? `<p class="sc-lead">${lead}</p>` : ''}</div>`;

const block = (inner: string): string => `<div class="ex-block">${inner}</div>`;
const sectionHead = (title: string, id: string, action: string | null = null): string =>
  `<div class="sc-between ex-head"><h2 class="sc-h3" id="${escapeHtml(id)}">${escapeHtml(title)}</h2>${action ?? ''}</div>`;

// ── tables shared by several pages ───────────────────────────────────────────

function blocksTable(rows: readonly BlockRow[], finalized: number | null, now: string, { hash = true, events = true } = {}): string {
  const columns = [
    { label: 'Block' },
    { label: 'Age' },
    ...(hash ? [{ label: 'Hash' }] : []),
    { label: 'Author' },
    { label: 'Extrinsics', align: 'right' as const },
    ...(events ? [{ label: 'Events', align: 'right' as const }] : []),
    { label: 'Finalized' },
  ];
  const body = rows.map((r) => [
    blockLink(r.number),
    relativeTime(r.timestampMs, now),
    ...(hash ? [address(r.hash, { href: blockPath({ kind: 'hash', hash: r.hash }) })] : []),
    accountLink(r.author),
    r.extrinsics === null ? muted('Unknown') : formatInt(r.extrinsics),
    ...(events ? [r.events === null ? muted('Unknown') : formatInt(r.events)] : []),
    finalized === null ? muted('Unknown') : r.number <= finalized ? badge('Finalized') : badge('Pending'),
  ]);
  return table({ columns, rows: body, empty: 'No blocks to show.', caption: 'Blocks' });
}

/** The fields that matter, in words, without the agents already shown in their own column. */
function details(entry: ActivityEntry, info: ChainInfo): string {
  const parts = entry.fields
    .filter((f) => !entry.agents.includes(f.value))
    .map((f) => {
      const label = sentence(words(f.name));
      if (f.kind === 'balance') return `${escapeHtml(label)} ${amount(BigInt(f.value), info)}`;
      if (f.kind === 'account') return `${escapeHtml(label)} ${address(f.value, { href: accountPath(f.value) })}`;
      const v = f.value.length > 24 ? truncateMiddle(f.value, 10, 6) : f.value;
      return `${escapeHtml(label)} <span title="${escapeHtml(f.value)}">${escapeHtml(v)}</span>`;
    });
  return parts.length ? parts.join(' · ') : muted('No further details');
}

function activityTable(entries: readonly ActivityEntry[], info: ChainInfo, now: string, { compact = false, empty = 'No agent events to show.' } = {}): string {
  // The per-agent events route records no times; a column of "not recorded" says nothing, so it goes.
  const timed = entries.length === 0 || entries.some((e) => e.timestampMs !== null);
  const time = timed ? [{ label: 'Time' }] : [];
  const columns = compact ? [...time, { label: 'Event' }, { label: 'Agent' }] : [...time, { label: 'Block' }, { label: 'Event' }, { label: 'Agents' }, { label: 'Details' }];
  const rows = entries.map((e) => {
    const name = escapeHtml(eventWords(e.section, e.method));
    const event = e.extrinsicIndex !== null ? `<a href="${extrinsicPath({ kind: 'number', number: e.blockNumber }, e.extrinsicIndex)}">${name}</a>${activityBadge(e)}` : `${name}${activityBadge(e)}`;
    const agents = e.agents.length ? e.agents.map((a) => address(a, { href: accountPath(a) })).join(' ') : muted('None named');
    const when = timed ? [relativeTime(e.timestampMs, now)] : [];
    return compact ? [...when, event, agents] : [...when, blockLink(e.blockNumber), event, agents, details(e, info)];
  });
  return table({ columns, rows, empty, caption: 'Agent events' });
}

// ── home ─────────────────────────────────────────────────────────────────────

export interface HomeModel {
  readonly ctx: PageContext;
  readonly heads: Live<{ best: number; finalized: number }>;
  readonly agents: Live<number>;
  readonly lastEmission: Live<{ readonly amount: bigint; readonly era: number | null }>;
  readonly blocks: Live<readonly BlockRow[]>;
  readonly activity: Live<readonly ActivityEntry[]>;
}

export function renderHome(m: HomeModel): string {
  const { ctx } = m;
  const now = ctx.renderedAt;
  const info = ctx.info;
  const statRow = stats(
    [
      liveStat('Block height', m.heads, (h) => `<a href="${blockPath({ kind: 'number', number: h.best })}">${formatInt(h.best)}</a>`),
      liveStat('Finalized', m.heads, (h) => `<a href="${blockPath({ kind: 'number', number: h.finalized })}">${formatInt(h.finalized)}</a>`),
      liveStat('Registered agents', m.agents, (n) => formatInt(n)),
      liveStat('Last era emission', m.lastEmission, (v) => amount(v.amount, info), m.lastEmission.value?.era !== null && m.lastEmission.value?.era !== undefined ? `Era ${formatInt(m.lastEmission.value.era)}` : null),
    ],
    { label: 'Chain figures' },
  );
  const finalized = m.heads.value?.finalized ?? null;
  const latestBlocks = m.blocks.value === null ? '<p class="sc-empty">The latest blocks cannot be shown right now.</p>' : blocksTable(m.blocks.value, finalized, now, { hash: false, events: false });
  const latestActivity =
    m.activity.value === null ? '<p class="sc-empty">The latest agent events cannot be shown right now.</p>' : activityTable(m.activity.value, info, now, { compact: true, empty: 'No agent events yet.' });
  const about = kvTable(
    [
      ['Chain', escapeHtml(CHAIN_NAME)],
      ['Runtime', `${escapeHtml(info.specName)} ${escapeHtml(info.specVersion)}`],
      ['Token', `${escapeHtml(info.tokenSymbol)}, ${escapeHtml(info.tokenDecimals)} decimals`],
      ['Address format', `SS58 prefix ${escapeHtml(info.ss58Format)}`],
      ['Genesis hash', address(info.genesisHash, { head: 10, tail: 8 })],
    ],
    { caption: 'About this chain' },
  );
  const body = `<div class="sc-container ex-page">
<h1 class="sc-sr">${escapeHtml(CHAIN_NAME)} explorer</h1>
<div class="ex-search">${searchBox()}</div>
${staleCallout([
  { name: 'Block height', live: m.heads },
  { name: 'Registered agents', live: m.agents },
  { name: 'Last era emission', live: m.lastEmission },
  { name: 'Latest blocks', live: m.blocks },
  { name: 'Latest activity', live: m.activity },
])}
${block(statRow)}
<div class="sc-cols-2 ex-block ex-compact">
  <section aria-labelledby="latest-blocks">${sectionHead('Latest blocks', 'latest-blocks', button({ text: 'View all', href: blocksPath(), variant: 'text' }))}${latestBlocks}</section>
  <section aria-labelledby="latest-activity">${sectionHead('Latest activity', 'latest-activity', button({ text: 'View all', href: activityPath(), variant: 'text' }))}${latestActivity}</section>
</div>
<section class="ex-block" aria-labelledby="about">${sectionHead('About this chain', 'about')}${about}</section>
</div>`;
  const read = `${nodeRead(ctx)} ${indexerRead(m.activity.value !== null ? m.activity.at : null, now)}`;
  return layout(ctx, {
    title: 'Explorer',
    description: `Search blocks, extrinsics, accounts and agent activity on the ${CHAIN_NAME}.`,
    path: '/',
    read,
    body,
  });
}

// ── blocks ───────────────────────────────────────────────────────────────────

export interface BlocksModel {
  readonly ctx: PageContext;
  readonly page: number;
  readonly total: number | null;
  readonly finalized: number | null;
  readonly rows: readonly BlockRow[];
  readonly listAt: string;
}

export function renderBlocks(m: BlocksModel): string {
  const { ctx } = m;
  const from = (m.page - 1) * PAGE_SIZE + 1;
  const to = from + m.rows.length - 1;
  const more = m.total === null ? m.rows.length === PAGE_SIZE : to < m.total;
  const body = `<div class="sc-container ex-page">
${pageHead('Blocks', 'Finalized blocks, newest first.', breadcrumb([{ text: 'Explorer', href: '/' }, { text: 'Blocks' }]))}
${block(`${blocksTable(m.rows, m.finalized, ctx.renderedAt)}
${pager(!m.rows.length, m.page, { prevHref: m.page > 1 ? blocksPath(m.page - 1) : null, nextHref: more ? blocksPath(m.page + 1) : null, from: m.rows.length ? from : 0, to: m.rows.length ? to : 0, total: m.total })}`)}
</div>`;
  return layout(ctx, {
    title: m.page > 1 ? `Blocks, page ${m.page}` : 'Blocks',
    description: `Every finalized block on the ${CHAIN_NAME}, newest first, with author, extrinsics and events.`,
    path: blocksPath(m.page),
    read: `${indexerRead(m.listAt, ctx.renderedAt)} Authors read from the node.`,
    body,
  });
}

/** Pagination, except on an empty first page: there the table's one-sentence empty state is the whole answer, not "Showing 0–0 of 0". */
function pager(empty: boolean, page: number, args: Parameters<typeof pagination>[0]): string {
  return empty && page <= 1 ? '' : pagination(args);
}

// ── block ────────────────────────────────────────────────────────────────────

export type BlockTab = 'extrinsics' | 'events';

/**
 * One event or argument value: a balance in CMN (planck value in `title`), an
 * account linked to its page, anything else as it was decoded. A planck count
 * on its own is a number without a unit, which a visitor cannot read.
 */
function balanceValue(field: { readonly value: string; readonly type?: string }, info: ChainInfo): string | null {
  const digits = field.value.replace(/,/g, '');
  return field.type !== undefined && /Balance/.test(field.type) && /^\d+$/.test(digits) ? amount(BigInt(digits), info) : null;
}

/** A decoded struct or list ("{\"weight\":…}") as words: "weight: ref time 125,000,000, proof size 1,493; class: Mandatory". */
function structWords(value: string): string | null {
  if (!/^[[{]/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const flat = (v: unknown, depth: number): string => {
    if (Array.isArray(v)) return v.length ? v.map((x) => flat(x, depth + 1)).join(', ') : 'none';
    if (v !== null && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => (depth === 0 ? `${words(k)}: ${flat(x, 1)}` : `${words(k)} ${flat(x, depth + 1)}`))
        .join(depth === 0 ? '; ' : ', ');
    }
    return v === null ? 'none' : String(v);
  };
  return typeof parsed === 'object' && parsed !== null ? flat(parsed, 0) : null;
}

function fieldValue(field: { readonly value: string; readonly type?: string }, info: ChainInfo): string {
  const balance = balanceValue(field, info);
  if (balance !== null) return balance;
  const struct = structWords(field.value);
  if (struct !== null) return `<span class="sc-small" title="${escapeHtml(field.value)}">${escapeHtml(sentence(struct))}</span>`;
  if (field.type !== undefined && /AccountId/.test(field.type) && /^[1-9A-HJ-NP-Za-km-z]{46,48}$/.test(field.value)) return accountLink(field.value);
  return `<span class="sc-mono" title="${escapeHtml(field.value)}">${escapeHtml(field.value.length > 24 ? truncateMiddle(field.value, 10, 6) : field.value)}</span>`;
}

function eventsTable(events: readonly (EventView & { extrinsicIndex?: number | null })[], blockNumber: number, info: ChainInfo, { withExtrinsic = true } = {}): string {
  const columns = [{ label: '#', align: 'right' as const }, ...(withExtrinsic ? [{ label: 'Extrinsic' }] : []), { label: 'Event' }, { label: 'Fields' }];
  const rows = events.map((e) => [
    formatInt(e.index),
    ...(withExtrinsic
      ? [e.extrinsicIndex === null || e.extrinsicIndex === undefined ? muted('Block') : `<a class="sc-mono" href="${extrinsicPath({ kind: 'number', number: blockNumber }, e.extrinsicIndex)}">${formatInt(blockNumber)}-${e.extrinsicIndex}</a>`]
      : []),
    `${escapeHtml(eventWords(e.section, e.method))}<br>${mono(`${e.section}.${e.method}`)}`,
    e.fields.length
      ? e.fields.map((f) => `${escapeHtml(sentence(words(f.name)))} ${fieldValue(f, info)}`).join('<br>')
      : muted('None'),
  ]);
  return table({ columns, rows, empty: 'No events here.', caption: 'Events' });
}

function outcomeBadge(outcome: { kind: string; reason?: string }): string {
  if (outcome.kind === 'success') return badge('Succeeded');
  if (outcome.kind === 'failed') return `${badge('Failed')} ${muted(outcome.reason ?? '')}`;
  return muted('Not recorded');
}

export function renderBlock(view: BlockView, tab: BlockTab, ctx: PageContext): string {
  const d = view.detail;
  const ref = { kind: 'number' as const, number: view.number };
  const finalized = d?.finalized.value;
  const best = d?.best ?? ctx.block;
  const kv = kvTable(
    [
      ['Number', mono(formatInt(view.number))],
      ['Hash', address(view.hash, { head: 10, tail: 8 })],
      ['Parent', view.number > 0 ? address(view.parentHash, { href: blockPath({ kind: 'number', number: view.number - 1 }), head: 10, tail: 8 }) : muted('Genesis has no parent')],
      ['Timestamp', view.timestampMs === null ? muted('Not recorded') : `${relativeTime(view.timestampMs, ctx.renderedAt)} · ${escapeHtml(formatUtc(Number(view.timestampMs)))}`],
      ['Author', accountLink(d?.author.value ?? null)],
      ['Finalized', finalized === true ? badge('Finalized') : finalized === false ? badge('Pending') : muted('Unknown')],
      ['Extrinsics', formatInt(view.extrinsics.length)],
      ['Events', d ? formatInt(d.events.length) : muted('Unknown')],
      ['State root', address(view.stateRoot, { head: 10, tail: 8 })],
    ],
    { caption: `Block ${formatInt(view.number)}` },
  );
  const extrinsics = table({
    columns: [{ label: 'ID' }, { label: 'Call' }, { label: 'Signer' }, { label: 'Result' }, { label: 'Hash' }],
    rows: view.extrinsics.map((x) => [
      `<a class="sc-mono" href="${extrinsicPath(ref, x.index)}">${formatInt(view.number)}-${x.index}</a>`,
      `${escapeHtml(callWords(x.section, x.method))}<br>${mono(`${x.section}.${x.method}`)}`,
      x.signer ? accountLink(x.signer) : muted('Unsigned'),
      outcomeBadge(x.outcome),
      address(x.hash),
    ]),
    empty: 'No extrinsics in this block.',
    caption: 'Extrinsics',
  });
  const path = blockPath(ref);
  const tabBar = tabs(
    [
      { label: 'Extrinsics', href: path, current: tab === 'extrinsics' },
      { label: 'Events', href: `${path}?tab=events`, current: tab === 'events' },
    ],
    { label: 'Block contents' },
  );
  const prev = view.number > 0 ? button({ text: 'Previous block', href: blockPath({ kind: 'number', number: view.number - 1 }), variant: 'secondary' }) : '';
  const next = best !== null && best !== undefined && view.number < best ? button({ text: 'Next block', href: blockPath({ kind: 'number', number: view.number + 1 }), variant: 'secondary' }) : '';
  const body = `<div class="sc-container ex-page">
${pageHead(`Block ${formatInt(view.number)}`, null, breadcrumb([{ text: 'Explorer', href: '/' }, { text: `Block ${formatInt(view.number)}` }]))}
${block(kv)}
${block(`${tabBar}${tab === 'events' ? eventsTable(d?.events ?? [], view.number, ctx.info) : extrinsics}`)}
${block(`<div class="sc-row">${prev}${next}</div>`)}
</div>`;
  return layout(ctx, {
    title: `Block ${formatInt(view.number)}`,
    description: `Block ${formatInt(view.number)} on the ${CHAIN_NAME}: hash, author, finality, extrinsics and events.`,
    path: tab === 'events' ? `${path}?tab=events` : path,
    read: nodeRead(ctx),
    body,
  });
}

// ── extrinsic ────────────────────────────────────────────────────────────────

/** The fee the runtime charged, from `transactionPayment.TransactionFeePaid`, when the block recorded one. */
export function feeOf(view: ExtrinsicView): bigint | null {
  const paid = view.events.find((e) => e.section === 'transactionPayment' && e.method === 'TransactionFeePaid');
  const field = paid?.fields.find((f) => f.name === 'actual_fee' || f.name === 'actualFee');
  if (!field) return null;
  const digits = field.value.replace(/,/g, '');
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}

export function renderExtrinsic(view: ExtrinsicView, ctx: PageContext): string {
  const ref = { kind: 'number' as const, number: view.block.number };
  const id = `${formatInt(view.block.number)}-${view.index}`;
  const fee = feeOf(view);
  const rows: [string, string][] = [
    ['Block', blockLink(view.block.number)],
    ['Index', formatInt(view.index)],
    ['Hash', address(view.hash, { head: 10, tail: 8 })],
    ['Signer', view.signer ? accountLink(view.signer) : muted('Unsigned (inherent)')],
    ['Call', `${escapeHtml(callWords(view.section, view.method))} ${mono(`${view.section}.${view.method}`)}`],
    ['Result', outcomeBadge(view.outcome)],
  ];
  if (fee !== null) rows.push(['Fee', amount(fee, ctx.info)]);
  rows.push(['Nonce', view.nonce === null ? muted('None (unsigned)') : formatInt(view.nonce)]);
  const args = table({
    columns: [{ label: 'Name' }, { label: 'Value' }],
    rows: view.args.map((a) => [`${escapeHtml(sentence(words(a.name)))}<br><span class="sc-caption">${escapeHtml(a.type)}</span>`, balanceValue(a, ctx.info) ?? `<span class="sc-mono ex-wrap">${escapeHtml(a.value)}</span>`]),
    empty: 'This call takes no arguments.',
    caption: 'Arguments',
  });
  const body = `<div class="sc-container ex-page">
${pageHead(`Extrinsic ${id}`, null, breadcrumb([{ text: 'Explorer', href: '/' }, { text: `Block ${formatInt(view.block.number)}`, href: blockPath(ref) }, { text: `Extrinsic ${id}` }]))}
${block(kvTable(rows, { caption: `Extrinsic ${id}` }))}
${block(`${sectionHead('Arguments', 'arguments')}${args}`)}
${block(`${sectionHead('Events', 'events')}${eventsTable(view.events, view.block.number, ctx.info, { withExtrinsic: false })}`)}
</div>`;
  return layout(ctx, {
    title: `Extrinsic ${id}`,
    description: `Extrinsic ${id} on the ${CHAIN_NAME}: call, signer, result, arguments and events.`,
    path: extrinsicPath(ref, view.index),
    read: nodeRead(ctx),
    body,
  });
}

// ── account ──────────────────────────────────────────────────────────────────

export type AccountTab = 'extrinsics' | 'activity';

export interface AgentCard {
  readonly name: string | null;
  readonly stake: bigint | null;
  readonly registeredAt: number | null;
  readonly lastHeartbeat: number | null;
  /** Heartbeat within the grace window: true Active, false Stale, null unknown. */
  readonly active: boolean | null;
  readonly operatorRun: boolean;
}

export interface Paged<T> {
  readonly total: number | null;
  readonly items: readonly T[];
  /** The indexer says this address is not a registered agent (so it has no agent events). */
  readonly notAgent?: boolean;
}

export interface AccountModel {
  readonly ctx: PageContext;
  readonly view: AccountView;
  readonly tab: AccountTab;
  readonly page: number;
  readonly agent: AgentCard | null;
  /** The open tab's list; null when this explorer has no indexer. */
  readonly list: Live<Paged<HistoryEntry> | Paged<ActivityEntry>> | null;
}

export function renderAccount(m: AccountModel): string {
  const { ctx, view } = m;
  const info = ctx.info;
  const path = accountPath(view.address);
  // A key/value table, not a stat row: a genesis-scale balance is wider than a stat cell at 1440 and 390.
  const statRow = kvTable(
    [
      ['Free balance', amount(view.free, info)],
      ['Reserved', amount(view.reserved, info)],
      ['Total', amount(view.free + view.reserved, info)],
      ['Extrinsics sent', formatInt(view.nonce)],
    ],
    { caption: 'Balances' },
  );
  const a = m.agent;
  const agentCard = a
    ? `<article class="sc-card ex-agent"><div class="sc-row"><h2 class="sc-h3">Agent</h2>${a.active === true ? badge('Active') : a.active === false ? badge('Stale') : ''}${a.operatorRun ? badge('Operator-run') : ''}</div>${kvTable([
        ['Name', a.name ? escapeHtml(a.name) : muted('No name published')],
        ['Stake', a.stake === null ? muted('Unavailable') : amount(a.stake, info)],
        ['Registered at block', a.registeredAt === null ? muted('Unavailable') : blockLink(a.registeredAt)],
        ['Last heartbeat', a.lastHeartbeat === null ? muted('None recorded') : `${blockLink(a.lastHeartbeat)}${ctx.block !== null ? ` ${muted(`(${formatInt(Math.max(0, ctx.block - a.lastHeartbeat))} blocks ago)`)}` : ''}`],
      ])}</article>`
    : '';
  const tabBar = tabs(
    [
      { label: 'Extrinsics', href: path, current: m.tab === 'extrinsics' },
      { label: 'Activity', href: `${path}?tab=activity`, current: m.tab === 'activity' },
    ],
    { label: 'Account history' },
  );
  const pageHref = (p: number): string => {
    const q = new URLSearchParams();
    if (m.tab === 'activity') q.set('tab', 'activity');
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const list = m.list;
  let listHtml: string;
  if (list === null) {
    listHtml = '<p class="sc-empty">History is not available on this explorer.</p>';
  } else if (list.value === null) {
    listHtml = callout({ variant: 'warning', body: escapeHtml(list.reason ?? 'The indexer did not answer in time.') });
  } else {
    const items = list.value.items;
    const from = (m.page - 1) * PAGE_SIZE + 1;
    const to = from + items.length - 1;
    const total = list.value.total;
    const more = total === null ? items.length === PAGE_SIZE : to < total;
    const tableHtml =
      m.tab === 'activity'
        ? activityTable(items as readonly ActivityEntry[], info, ctx.renderedAt, { empty: list.value.notAgent ? NOT_AGENT : 'No agent events name this account in the indexed history.' })
        : historyTable(items as readonly HistoryEntry[], ctx.renderedAt);
    listHtml = `${list.stale ? callout({ variant: 'warning', body: escapeHtml(list.reason ?? '') }) : ''}${tableHtml}${pager(!items.length, m.page, { prevHref: m.page > 1 ? pageHref(m.page - 1) : null, nextHref: more ? pageHref(m.page + 1) : null, from: items.length ? from : 0, to: items.length ? to : 0, total })}`;
  }
  const body = `<div class="sc-container ex-page">
${pageHead('Account', null, breadcrumb([{ text: 'Explorer', href: '/' }, { text: 'Account' }]))}
<p class="sc-row ex-address"><span class="sc-mono ex-wrap">${escapeHtml(view.address)}</span>${copyOnly(view.address)}</p>
<div class="ex-block ex-balances">${statRow}</div>
${agentCard ? block(agentCard) : ''}
${block(`${tabBar}${listHtml}`)}
</div>`;
  const listRead = list && list.value !== null ? ` ${indexerRead(list.at, ctx.renderedAt)}` : '';
  return layout(ctx, {
    title: `Account ${truncateMiddle(view.address)}`,
    description: `Balances, agent registration and history of account ${view.address} on the ${CHAIN_NAME}.`,
    path: m.tab === 'activity' ? `${path}?tab=activity` : path,
    read: `${nodeRead({ ...ctx, block: view.at.number })}${listRead}`,
    body,
  });
}

/** An account's extrinsics; the Time column only when the indexer recorded times (a column of "not recorded" says nothing). */
function historyTable(items: readonly HistoryEntry[], now: string): string {
  const timed = items.some((h) => h.timestampMs !== null);
  return table({
    columns: [{ label: 'ID' }, ...(timed ? [{ label: 'Time' }] : []), { label: 'Call' }, { label: 'Result' }],
    rows: items.map((h) => [
      `<a class="sc-mono" href="${extrinsicPath({ kind: 'number', number: h.blockNumber }, h.index)}">${formatInt(h.blockNumber)}-${h.index}</a>`,
      ...(timed ? [relativeTime(h.timestampMs, now)] : []),
      escapeHtml(callWords(h.section, h.method)),
      h.success === true ? badge('Succeeded') : h.success === false ? badge('Failed') : muted('Not recorded'),
    ]),
    empty: 'This account has sent no extrinsics in the indexed history.',
    caption: 'Extrinsics',
  });
}

/** The copy button alone, for a value already shown in full. */
const copyOnly = (value: string): string => {
  const html = address(value);
  const at = html.indexOf('<button');
  return at === -1 ? '' : html.slice(at, html.lastIndexOf('</span>'));
};

// ── activity ─────────────────────────────────────────────────────────────────

/** The filter chips, as on /network: label → the indexer's `kind`. */
export const ACTIVITY_FILTERS: readonly { label: string; kind: string | null }[] = [
  { label: 'All', kind: null },
  { label: 'Agreements', kind: 'agreement' },
  { label: 'Disputes', kind: 'dispute' },
  { label: 'Messages', kind: 'message' },
  { label: 'Registrations', kind: 'registration' },
  { label: 'Slashes', kind: 'slash' },
];

export interface ActivityModel {
  readonly ctx: PageContext;
  readonly agent: string | null;
  readonly kind: string | null;
  readonly page: number;
  readonly total: number | null;
  readonly historyFrom: number | null;
  readonly entries: readonly ActivityEntry[];
  readonly listAt: string;
  /** The indexer says the filtered address is not a registered agent. */
  readonly notAgent?: boolean;
}

const NOT_AGENT = 'This address is not a registered agent, so it has no agent events.';

export function renderActivity(m: ActivityModel): string {
  const { ctx } = m;
  const from = (m.page - 1) * PAGE_SIZE + 1;
  const to = from + m.entries.length - 1;
  const more = m.total === null ? m.entries.length === PAGE_SIZE : to < m.total;
  const intro = m.historyFrom !== null ? `Agent events, newest first. History reaches back to block ${blockLink(m.historyFrom)}.` : 'Agent events, newest first.';
  const filterChips = chips(
    ACTIVITY_FILTERS.map((f) => ({ label: f.label, href: activityPath(m.agent, 1, f.kind), current: f.kind === m.kind })),
    { label: 'Event type' },
  );
  const agentFilter = `<form class="sc-search-row" role="search" action="/activity" method="get">${m.kind ? `<input type="hidden" name="kind" value="${escapeHtml(m.kind)}">` : ''}<label class="sc-search"><span class="sc-sr">Filter by agent address</span>${icon('search')}<input class="sc-input" type="search" name="agent" value="${escapeHtml(m.agent ?? '')}" placeholder="Filter by agent address" autocomplete="off" spellcheck="false"></label><button class="sc-btn sc-btn-secondary" type="submit">Filter</button></form>`;
  const showing = m.agent ? `<p class="sc-row sc-small">Events naming ${address(m.agent, { href: accountPath(m.agent) })} ${button({ text: 'Show every agent', href: activityPath(null, 1, m.kind), variant: 'text' })}</p>` : '';
  const empty = m.notAgent ? NOT_AGENT : m.agent ? 'No agent events name this address in the indexed history.' : 'No agent events of this type in the indexed history.';
  const body = `<div class="sc-container ex-page">
${pageHead('Activity', intro, breadcrumb([{ text: 'Explorer', href: '/' }, { text: 'Activity' }]))}
<div class="ex-block sc-stack">${filterChips}${agentFilter}${showing}</div>
${block(`${activityTable(m.entries, ctx.info, ctx.renderedAt, { empty })}
${pager(!m.entries.length, m.page, { prevHref: m.page > 1 ? activityPath(m.agent, m.page - 1, m.kind) : null, nextHref: more ? activityPath(m.agent, m.page + 1, m.kind) : null, from: m.entries.length ? from : 0, to: m.entries.length ? to : 0, total: m.total })}`)}
</div>`;
  return layout(ctx, {
    title: 'Activity',
    description: `Agent events on the ${CHAIN_NAME}, newest first: registrations, agreements, disputes, messages and slashes.`,
    path: activityPath(m.agent, m.page, m.kind),
    read: indexerRead(m.listAt, ctx.renderedAt),
    body,
  });
}

// ── search, errors ───────────────────────────────────────────────────────────

const FORMATS = `<div class="sc-prose ex-block"><ul>
<li>A block number</li>
<li>A block hash: 0x followed by sixty-four hex characters</li>
<li>An extrinsic as block-index: a block number, a hyphen and the extrinsic's position in the block</li>
<li>An account address in SS58 form</li>
</ul></div>`;

export function renderNothingFound(query: string, ctx: PageContext): string {
  const body = `<div class="sc-container ex-page">
${pageHead(`Nothing found for '${query}'`, 'Check the value and search again.')}
<div class="ex-search">${searchBox(query)}</div>
<p class="sc-body">Search accepts four formats:</p>
${FORMATS}
</div>`;
  return layout(ctx, { title: 'Nothing found', description: `No block, extrinsic or account on the ${CHAIN_NAME} matches this search.`, path: searchPath(query), read: 'This page read nothing from the chain.', body });
}

const ERROR_TITLES: Readonly<Record<number, string>> = {
  400: 'Not a valid request',
  404: 'Page not found',
};

/** A plain title, one sentence, the search field. Never an internal address or a stack trace. */
export function renderError(status: number, message: string, ctx: PageContext): string {
  const title = ERROR_TITLES[status] ?? 'Something went wrong';
  const body = `<div class="sc-container ex-page">
${pageHead(title, escapeHtml(message))}
<div class="ex-block ex-search">${searchBox()}</div>
</div>`;
  return layout(ctx, { title, description: message, path: '/', read: 'This page read nothing from the chain.', body });
}
