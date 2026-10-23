/**
 * Server-side HTML rendering, in the Nightwatch chrome.
 *
 * Pure functions from view model to markup: no chain access, no JavaScript
 * shipped to the browser beyond the activity page's meta refresh, no
 * client-side framework. An explorer is read-only by nature, so a page that
 * arrives fully rendered is both the simplest thing that works and the one
 * that keeps working when a node is slow — there is no second round trip to
 * fail.
 *
 * Every figure is a Reading filled from the node (or the index) at request
 * time and carries an `AS OF <UTC>` tag and a receipt naming the RPC or
 * storage item it came from; a read that failed renders `unavailable` and the
 * reason, never a guess. Every interpolated value goes through `escapeHtml`,
 * because every value on these pages came off a public chain and is therefore
 * attacker-supplied.
 */

import {
  address as addressChip,
  agentName,
  attrs,
  band,
  code,
  copy,
  curve,
  curvePaths,
  field,
  filter,
  footer,
  formatInt,
  head,
  lampFilled,
  ledger,
  pager,
  quiet,
  rail,
  raw,
  reading,
  spine,
  tag,
  topBar,
  utc,
  type LedgerRow,
  type RailEntry,
  type State,
} from './chrome-templates.js';
import { escapeHtml, formatBalance, formatTimestamp, shortHash } from './format.js';
import { accountPath, activityPath, blockPath, extrinsicPath, SEARCH_PATH } from './routes.js';
import { heartbeatDecayed, heartbeatMultiplier } from './types.js';
import type {
  AccountView,
  ActivityEntry,
  ActivityField,
  ActivityView,
  BlockView,
  ChainInfo,
  EventView,
  ExtrinsicSummary,
  ExtrinsicView,
  HomeView,
  Outcome,
  Read,
  Source,
} from './types.js';

/**
 * Layout glue the chrome does not carry yet, in the Ledger's terms: blocks on
 * the 12-column grid (x-col-n), the explorer Spine spanning its columns, the
 * search form, the raw disclosure and the share bar. Layout only — no colour,
 * no face, no size and no spacing off the chrome's scales (every length is a
 * --s-n step or a calc of them) — and a request for the chrome
 * (landing/src/chrome/README.md, "Asking for a change") rather than a theme.
 */
const EXPLORER_LAYOUT_CSS = `.x-col-4{grid-column:1/span 4}.x-col-8{grid-column:5/span 8}.x-col-6{grid-column:span 6}.x-col-12{grid-column:1/-1}.x-wrap{grid-auto-flow:row;grid-template-columns:repeat(3,minmax(0,1fr));row-gap:var(--s-6)}.x-rows>.nw-row+.nw-row{margin-top:var(--s-6)}.x-wide .nw-reading-figure{max-width:100%}.nw-reading .nw-reading-figure .nw-figure--body{white-space:normal;overflow-wrap:anywhere}.nw-reading.x-wide .nw-reading-figure .nw-figure,.x-hash{white-space:normal;overflow-wrap:anywhere;word-break:break-all}.nw-section-head h1{min-width:0;max-width:100%;overflow-wrap:anywhere}.nw-ledger-row>span{min-width:0;overflow-wrap:anywhere}.nw-ledger-row .nw-tag{white-space:normal}.nw-spine--explorer{width:100%}.nw-spine--explorer .nw-spine-tick{grid-template-columns:max-content max-content max-content minmax(0,1fr) max-content;column-gap:var(--s-3)}.nw-spine--explorer .nw-spine-tick>span{min-width:0;white-space:nowrap}.nw-spine--explorer .nw-spine-tick>span:nth-child(4){overflow:hidden;text-overflow:ellipsis}.x-glyph{display:inline-block;position:relative;width:var(--s-3);height:var(--s-3);margin-right:var(--s-1);vertical-align:middle}.x-glyph::before,.x-glyph::after{content:"";position:absolute}.x-glyph[data-kind="agreement"]{height:var(--s-2);border-left:1px solid var(--ink);border-right:1px solid var(--ink)}.x-glyph[data-kind="agreement"]::before{left:0;right:0;top:calc(var(--s-1) - var(--s-1) / 8);border-top:1px solid var(--ink)}.x-glyph[data-kind="message"]::before{left:0;top:calc(var(--s-1));width:var(--s-1);height:var(--s-1);background:var(--ink-3)}.x-glyph[data-kind="message"]::after{left:var(--s-1);right:0;top:calc(var(--s-1) * 1.5);border-top:1px solid var(--rule-2)}.x-glyph[data-kind="settled"]::before{left:0;top:calc(var(--s-1) * 0.75);width:var(--s-1);height:calc(var(--s-1) * 1.5);background:var(--ink)}.x-glyph[data-kind="settled"]::after{left:var(--s-1);right:0;top:calc(var(--s-1) * 1.5);border-top:1px solid var(--ink-3)}.x-glyph[data-kind="dispute"]::before{left:0;right:0;top:calc(var(--s-1) * 1.5);border-top:1px dashed var(--ink)}.x-glyph[data-kind="oracle"]{width:0;border-left:1px solid var(--ink)}.x-glyph[data-kind="registered"]::before{left:0;right:0;top:0;border-top:2px solid var(--ink)}@media(max-width:480px){.x-col-4,.x-col-8,.x-col-6{grid-column:1/-1}.x-wrap{grid-template-columns:minmax(0,1fr)}.nw-row.nw-row.nw-row.nw-row .nw-reading-figure .nw-figure{font:var(--figure-m)}.nw-row.nw-row.nw-row:has(> :nth-child(3)) .nw-reading-figure .nw-figure,.nw-row.nw-row.nw-row[data-step-m="1"] .nw-reading-figure .nw-figure{font:var(--figure-s)}}.nw-search{margin-block:var(--s-5)}.nw-raw-details summary{cursor:pointer;list-style:none}.nw-raw-details[open] summary{margin-bottom:var(--s-2)}.nw-share{min-width:calc(var(--s-1) / 2)}.nw-section-head .nw-tag{margin-left:auto}.nw-section-head .nw-tag+.nw-tag{margin-left:0}@media(min-width:481px){.nw-ledger-row{grid-template-columns:minmax(var(--s-7),auto) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr) auto}.nw-ledger-row>:first-child{white-space:nowrap}}`;

/** The source a view carries for a figure it did not read: a leader to nothing, with the reason. */
const NOT_READ: Source = { method: 'RPC', url: 'not read in this view', fetchedAt: null, block: null, raw: null };

/**
 * A row of Readings, sized as the chrome sizes it (one figure size per row by
 * count: 1 xl, 2 l, 3–4 m, 5–6 s; at 480 px and under one column, a step
 * down). The explorer ships no script, so behaviour/fit.js cannot drop an
 * overflowing row a step at render; the server does it instead, and it can,
 * exactly: IBM Plex Mono advances 0.6 em per glyph, so a figure's width is its
 * length × 0.6 × its size, plus its unit (--label, 0.72 em a glyph with the
 * tracking, 8 px after the figure) and the stub (20 px, 8 px after). A row
 * that would spill at 1440 px gets data-step="1" (the chrome's own step); one
 * that would spill in the 350 px phone column gets data-step-m="1", which the
 * page's layout CSS sets at --figure-s. At 480 px and under the layout CSS
 * also restates the chrome's phone sizes (1–2 → m, 3+ → s) at a specificity
 * that beats the desktop count rules, which otherwise outrank them.
 */
const FIGURE_PX = { xl: 64, l: 44, m: 28, s: 20 } as const;
type FigureStep = keyof typeof FIGURE_PX;
const sizeByCount = (count: number): FigureStep => (count <= 1 ? 'xl' : count === 2 ? 'l' : count <= 4 ? 'm' : 's');
const phoneSizeByCount = (count: number): FigureStep => (count >= 3 ? 's' : 'm');
/** The frame (--content), the gutter, and the phone column (390 px less two 20 px gutters). */
const FRAME_PX = 1200;
const GUTTER_PX = 24;
const PHONE_COLUMN_PX = 390 - 2 * 20;
const decodeText = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
export const figureWidthPx = (text: string, unit: string | null, size: FigureStep): number =>
  [...text].length * 0.6 * FIGURE_PX[size] + (unit ? 8 + [...unit].length * 0.72 * 11 : 0) + 8 + 20;

const figureOfHtml = (html: string): { text: string; unit: string | null } => ({
  text: decodeText(/data-reading-value[^>]*>([\s\S]*?)(?:<span class="nw-unit">|<\/span>)/.exec(html)?.[1] ?? ''),
  unit: /<span class="nw-unit">([^<]*)<\/span>/.exec(html)?.[1] ?? null,
});

/** Whether a row of these Readings spills at 1440 px even one step down. */
const rowSpills = (readings: readonly string[]): boolean => {
  const count = readings.length;
  const column = (FRAME_PX - (count - 1) * GUTTER_PX) / count;
  const stepped = DOWN[sizeByCount(count)];
  return readings.map(figureOfHtml).some((f) => figureWidthPx(f.text, f.unit, stepped) > column);
};
const DOWN: Readonly<Record<FigureStep, FigureStep>> = { xl: 'l', l: 'm', m: 's', s: 's' };

export function readingRow(readings: readonly string[], className = ''): string {
  const count = readings.length;
  const column = (FRAME_PX - (count - 1) * GUTTER_PX) / count;
  const figures = readings.map(figureOfHtml);
  const spills = (size: FigureStep, width: number): boolean => figures.some((f) => figureWidthPx(f.text, f.unit, size) > width);
  const phone = phoneSizeByCount(count);
  return `<div class="nw-row${className ? ` ${className}` : ''}"${attrs({
    'data-step': spills(sizeByCount(count), column) ? '1' : null,
    'data-step-m': phone !== 's' && spills(phone, PHONE_COLUMN_PX) ? '1' : null,
  })}>
${readings.join('\n')}
</div>`;
}

/**
 * Readings that may not fit one row: when a figure spills its column even a
 * step down (a 24-glyph balance in a quarter of the frame), the Readings split
 * into rows of half as many, each row still sized by its own count — never a
 * figure cut short, never two figures colliding.
 */
export function readingRows(readings: readonly string[]): string {
  let per = readings.length;
  while (per > 1) {
    const chunks: string[][] = [];
    for (let i = 0; i < readings.length; i += per) chunks.push(readings.slice(i, i + per));
    if (!chunks.some(rowSpills)) break;
    per = Math.ceil(per / 2);
  }
  const rows: string[] = [];
  for (let i = 0; i < readings.length; i += per) rows.push(readingRow(readings.slice(i, i + per)));
  return rows.length === 1 ? (rows[0] ?? '') : `<div class="x-rows">\n${rows.join('\n')}\n</div>`;
}

/** What the lamp and footer know about the chain at render time. */
interface Frame {
  readonly chain: ChainInfo | null;
  readonly renderedAt: string | null;
  readonly best: number | null;
  readonly finalized: number | null;
  readonly headAgeMs: number | null;
  readonly indexerLine?: string | null;
  readonly refreshSeconds?: number;
}

/** The lamp as the server fills it. Lit only when the newest block is under 30 s old at render — the lamp rule. */
function lampFor(frame: Frame): string {
  if (frame.best === null) {
    return lampFilled({ state: 'connecting', lit: false, text: 'not connected' });
  }
  const asOf = frame.renderedAt ? ` · as of ${utc(frame.renderedAt)}` : '';
  if (frame.headAgeMs === null) {
    return lampFilled({ state: 'normal', lit: false, text: `block ${formatInt(frame.best)}${asOf}` });
  }
  if (frame.headAgeMs >= 30_000) {
    const minutes = Math.floor(frame.headAgeMs / 60_000);
    return lampFilled({ state: 'stalled', lit: false, text: `last block ${formatInt(frame.best)} · ${minutes} min ago · stalled` });
  }
  // The lamp's words, as the landing's lamp prints them: `block n · fin k`.
  const finality = frame.finalized === null ? 'fin —' : `fin ${formatInt(frame.best - frame.finalized)}`;
  return lampFilled({ state: 'normal', lit: true, text: `block ${formatInt(frame.best)} · ${finality}` });
}

/**
 * Wraps a page body in the chrome: the bar with the lamp, the frame, the
 * footer. `refreshSeconds` makes the page reload itself — the one way a
 * server-rendered, script-free page stays live.
 */
function layout(title: string, frame: Frame, body: string): string {
  const facts = {
    genesisHash: frame.chain?.genesisHash ?? '—',
    specVersion: frame.chain?.specVersion ?? '—',
    nodeVersion: frame.chain?.nodeVersion ?? null,
    builtAt: frame.renderedAt,
    block: frame.best,
  };
  const refresh =
    frame.refreshSeconds === undefined ? '' : `\n<meta http-equiv="refresh" content="${frame.refreshSeconds}">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
${head({ title, description: 'Scalar Commons block explorer: blocks, extrinsics, accounts and agent activity read from the node at request time.', extraHead: `<style>${EXPLORER_LAYOUT_CSS}</style>${refresh}` })}
</head>
<body>
${topBar({ current: 'explorer', lampHtml: lampFor(frame) })}
<main class="nw-frame">
${body}
</main>
${footer({ facts, extraLine: frame.indexerLine ?? null })}
</body>
</html>
`;
}

/** `AS OF <UTC>` — the render time every page states, in the built style (no dot, dim). */
const asOfTag = (renderedAt: string | null): string =>
  tag({ state: 'built', text: `AS OF ${renderedAt ? (utc(renderedAt) ?? '—') : '—'}` });

const sectionHead = (label: string, count: number | null = null, extra = ''): string =>
  `<div class="nw-section-head"><h2 class="nw-label">${escapeHtml(label)}${
    count === null ? '' : ` · ${formatInt(count)}`
  }</h2>${extra}</div>`;

/**
 * One Reading from one `Read`. A failed read, or one the view did not make,
 * renders `unavailable` with the reason as the sub-line, in sage.
 */
function readingOf<T>(
  label: string,
  read: Read<T> | undefined,
  format: (value: T) => string,
  options: { size?: 'xl' | 'l' | 'm' | 's' | 'body'; href?: string | null; state?: State; figureHtml?: (value: T) => string; sub?: string | null; stack?: boolean; wide?: boolean; unit?: string | null } = {},
): string {
  const stack = options.stack ?? true;
  const className = options.wide ? 'x-wide' : '';
  if (read === undefined) {
    return reading({ label, figure: 'unavailable', size: 'body', stack, className: `is-unavailable nw-sage ${className}`, sub: 'not read in this view', source: NOT_READ });
  }
  if (read.value === null && read.reason !== null) {
    return reading({ label, figure: 'unavailable', size: 'body', stack, className: `is-unavailable nw-sage ${className}`, sub: read.reason, source: read.source });
  }
  const value = read.value as T;
  return reading({
    label,
    figure: format(value),
    figureHtml: options.figureHtml ? options.figureHtml(value) : null,
    size: options.size ?? 'm',
    href: options.href ?? null,
    state: options.state ?? 'record',
    sub: options.sub ?? null,
    unit: options.unit ?? null,
    stack,
    className,
    source: read.source,
  });
}

/** A reading whose value the view already holds (a header field, a balance), with its source. */
function fact(label: string, figure: string, source: Source, options: { size?: 'xl' | 'l' | 'm' | 's' | 'body'; href?: string | null; figureHtml?: string | null; state?: State; stack?: boolean; wide?: boolean; unit?: string | null } = {}): string {
  return reading({ label, figure, size: options.size ?? 'body', href: options.href ?? null, figureHtml: options.figureHtml ?? null, state: options.state ?? 'record', stack: options.stack ?? true, unit: options.unit ?? null, className: options.wide ? 'x-wide' : '', source });
}

/** A hash-bearing Reading: stacked, full-width, wrapping anywhere — a 66-character hash never sets the page's width. */
const hashFact = (label: string, figure: string, source: Source, options: { href?: string | null; figureHtml?: string | null } = {}): string =>
  `<div class="x-col-12">${fact(label, figure, source, { ...options, stack: true, wide: true })}</div>`;

/** Whole tokens with grouping, for the figure of a balance; the unit goes beside it at --label size and the exact plancks on the receipt's computation line. */
const wholeTokens = (plancks: bigint, decimals: number): string => formatInt(plancks / 10n ** BigInt(decimals));

/** A balance as a figure without its symbol: the symbol is the Reading's unit, printed at --label size on the figure's baseline. */
const tokenFigure = (plancks: bigint, decimals: number, symbol: string): string => {
  const text = formatBalance(plancks, decimals, symbol);
  return text.endsWith(` ${symbol}`) ? text.slice(0, -(symbol.length + 1)) : text;
};

/** Clock time `HH:MM:SS` of a block's timestamp for a dense row; the full UTC goes on the title. */
const clockTime = (timestampMs: bigint | null): string => {
  const iso = formatTimestamp(timestampMs);
  const match = /T(\d\d:\d\d:\d\d)/.exec(iso);
  return match?.[1] ?? iso;
};

const sourceAt = (method: string, url: string, block: number | null, fetchedAt: string | null, computed: string | null = null): Source => ({
  method,
  url,
  fetchedAt,
  block,
  raw: null,
  computed,
});

/** Renders a dispatch outcome as its tag, keeping "unknown" visibly distinct from "success". */
function outcomeTag(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'success':
      return tag({ state: 'sealed', text: 'SUCCEEDED' });
    case 'failed':
      return tag({ state: 'dispute', text: `FAILED · ${outcome.reason}` });
    case 'unknown':
      return tag({ state: 'record', text: 'OUTCOME NOT RECORDED' });
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
function signerCell(isSigned: boolean, signer: string | null, unsignedLabel: string): string {
  if (signer !== null) {
    return addressChip(signer, { href: accountPath(signer) });
  }
  return isSigned
    ? '<span class="nw-sage">signed (its address is not an AccountId)</span>'
    : `<span class="nw-sage">${escapeHtml(unsignedLabel)}</span>`;
}

function accountLink(address: string): string {
  return `<a class="nw-mono" href="${escapeHtml(accountPath(address))}">${escapeHtml(address)}</a>`;
}

function blockLinkByNumber(number: number): string {
  return `<a href="${escapeHtml(blockPath({ kind: 'number', number }))}">${formatInt(number)}</a>`;
}

function blockLinkByHash(hash: string): string {
  return `<a class="nw-mono" href="${escapeHtml(blockPath({ kind: 'hash', hash }))}">${escapeHtml(shortHash(hash))}</a>`;
}

const hashWithCopy = (hash: string): string =>
  `<span class="nw-copyable nw-mono">${escapeHtml(hash)}${copy(hash, 'Copy hash')}</span>`;

const rawDetails = (value: unknown): string => `<details class="nw-raw-details"><summary class="nw-label">▸ raw</summary>${raw(value)}</details>`;

const extrinsicLedgerRow = (blockNumber: number, extrinsic: ExtrinsicSummary): LedgerRow => ({
  id: `${blockNumber}-${extrinsic.index}`,
  cells: [
    `<a href="${escapeHtml(extrinsicPath({ kind: 'number', number: blockNumber }, extrinsic.index))}">${formatInt(blockNumber)}-${extrinsic.index}</a>`,
    `<a class="nw-mono" href="${escapeHtml(extrinsicPath({ kind: 'number', number: blockNumber }, extrinsic.index))}">${escapeHtml(shortHash(extrinsic.hash, 6))}</a>`,
    escapeHtml(`${extrinsic.section}.${extrinsic.method}`),
    signerCell(extrinsic.isSigned, extrinsic.signer, 'unsigned'),
    outcomeTag(extrinsic.outcome),
  ],
});

const eventLedgerRow = (blockNumber: number | null, event: EventView & { extrinsicIndex?: number | null }): LedgerRow => ({
  id: blockNumber === null ? String(event.index) : `${blockNumber}-${event.index}`,
  cells: [
    String(event.index),
    escapeHtml(`${event.section}.${event.method}`),
    event.fields.map((f) => `${escapeHtml(f.name)}: ${escapeHtml(f.value)}`).join('<br>'),
    event.extrinsicIndex === undefined || event.extrinsicIndex === null || blockNumber === null
      ? ''
      : `<a href="${escapeHtml(extrinsicPath({ kind: 'number', number: blockNumber }, event.extrinsicIndex))}">${formatInt(blockNumber)}-${event.extrinsicIndex}</a>`,
    rawDetails(event.fields),
  ],
});

/**
 * The pulse model's event table (landing/src/pulse/model.js, EVENTS): the
 * runtime events the site draws, their kind and their word. The Spine's event
 * column prints one glyph per kind present in a block, in the Waterfall's
 * Ledger marks (SITE-ROUND2.md §1.2): agreement a line with end ticks,
 * message a 4×4 cell with a light line, work paid for a 4×6 cell, dispute a
 * dashed line, oracle answer a 1×12 tick, agent joined a printed head.
 * `resolved` draws no glyph of its own (it ends a dispute's line), as in the
 * Waterfall. tests/chrome.test.ts holds this table to model.js's.
 */
export const PULSE_EVENTS: readonly { readonly section: string; readonly method: string; readonly kind: string; readonly describe: string }[] = [
  { section: 'escrow', method: 'AgreementCreated', kind: 'agreement', describe: 'agreement opened' },
  { section: 'messages', method: 'MessageSent', kind: 'message', describe: 'message sent' },
  { section: 'escrow', method: 'DeliveryConfirmed', kind: 'settled', describe: 'work paid for' },
  { section: 'escrow', method: 'DisputeOpened', kind: 'dispute', describe: 'dispute opened' },
  { section: 'escrow', method: 'DisputeResolved', kind: 'resolved', describe: 'dispute resolved' },
  { section: 'oracle', method: 'OracleResponseSubmitted', kind: 'oracle', describe: 'oracle answer' },
  { section: 'oracle', method: 'BatchResponseSubmitted', kind: 'oracle', describe: 'oracle answer' },
  { section: 'agents', method: 'AgentRegistered', kind: 'registered', describe: 'agent joined' },
];
/** The kinds that draw, in the Waterfall legend's order. */
const GLYPH_KINDS = ['agreement', 'message', 'settled', 'dispute', 'oracle', 'registered'] as const;

/** One glyph per drawing kind present among `events`, in the legend's order; '' when none. */
export function eventGlyphs(events: readonly { readonly section: string; readonly method: string }[]): string {
  const present = new Map<string, string>();
  for (const event of events) {
    const row = PULSE_EVENTS.find((r) => r.section === event.section && r.method === event.method);
    if (row && !present.has(row.kind)) present.set(row.kind, row.describe);
  }
  return GLYPH_KINDS.filter((kind) => present.has(kind))
    .map((kind) => {
      const word = escapeHtml(present.get(kind) ?? kind);
      return `<span class="x-glyph" data-kind="${kind}" role="img" aria-label="${word}" title="${word}"></span>`;
    })
    .join('');
}

// ── home ─────────────────────────────────────────────────────────────────────

/** The index page: the search field, the six readings, the Spine, the ledgers, the pool. */
export function renderHome(view: HomeView): string {
  const r = view.readings;
  const renderedAt = r?.renderedAt ?? null;
  const headSource = sourceAt('RPC', 'chain_getHeader', view.head.number, renderedAt);
  const balance = (value: bigint): string => formatBalance(value, view.chain.tokenDecimals, view.chain.tokenSymbol);

  const search = `<form class="nw-search" method="get" action="${SEARCH_PATH}">${field({
    name: 'q',
    label: 'Search',
    placeholder: 'block number, hash, extrinsic, address, agent name',
  })}</form>`;

  // Six Readings as two rows of three, so each row has one figure size
  // (§2.5: 3–4 in a row → --figure-m) and nothing wraps at 1440 px.
  const readings = `<div class="x-rows">
${readingRow([
  fact('Best', formatInt(view.head.number), headSource, { size: 'm', href: blockPath({ kind: 'number', number: view.head.number }), state: r && r.headAgeMs !== null && r.headAgeMs < 30_000 ? 'live' : 'record' }),
  readingOf('Finalized', r?.finalized, (f) => formatInt(f.number), { href: r?.finalized.value ? blockPath({ kind: 'number', number: r.finalized.value.number }) : null }),
  readingOf('Era', r?.era, (e) => `${formatInt(e.number)} · ${formatInt(e.elapsed)} / ${formatInt(e.length)}`),
])}
${readingRow([
  readingOf('Session', r?.session, (s) => `${formatInt(s.index)} · ${formatInt(s.elapsed)} / ${formatInt(s.length)}`),
  readingOf('Validators', r?.validators, (n) => formatInt(n)),
  readingOf('Issuance', r === undefined ? undefined : r.issuance.value === null ? r.issuance : { ...r.issuance, source: { ...r.issuance.source, computed: `${r.issuance.value.toString()} plancks · whole ${view.chain.tokenSymbol}` } }, (value) => wholeTokens(value, view.chain.tokenDecimals), { unit: view.chain.tokenSymbol }),
])}
</div>`;

  const recent = r?.recent.value ?? [];
  const finalizedNumber = r?.finalized.value?.number ?? null;
  const spineHtml =
    r === undefined || r.recent.value === null
      ? readingOf('Recent blocks', r?.recent, () => '')
      : spine({
          form: 'explorer',
          ariaLabel: `The newest ${recent.length} blocks`,
          ticks: recent.map((block, position) => ({
            number: block.number,
            newest: position === 0 && r.headAgeMs !== null && r.headAgeMs < 30_000,
            final: finalizedNumber !== null && block.number <= finalizedNumber,
            html: `<span class="nw-mono">${blockLinkByNumber(block.number)}</span><span class="nw-mono" title="${escapeHtml(
              block.timestampMs === null ? 'no timestamp' : (utc(formatTimestamp(block.timestampMs)) ?? ''),
            )}">${escapeHtml(block.timestampMs === null ? 'no timestamp' : clockTime(block.timestampMs))}</span><span class="nw-mono">${block.extrinsics.length} ex</span><span class="nw-mono">${
              block.author ? addressChip(block.author, { href: accountPath(block.author) }) : '<span class="nw-sage">author —</span>'
            }</span><span class="nw-mono">${eventGlyphs(block.events)}${block.events.length} ev</span>`,
          })),
        });

  const lastExtrinsics = recent.flatMap((block) => block.extrinsics.map((extrinsic) => extrinsicLedgerRow(block.number, extrinsic))).slice(0, 12);
  const lastEvents = recent.flatMap((block) => block.events.map((event) => eventLedgerRow(block.number, event))).slice(0, 12);
  const ledgers = `${sectionHead('Extrinsics', null, asOfTag(renderedAt))}
${lastExtrinsics.length === 0 ? '<p class="nw-small nw-dim">No extrinsics in the blocks read.</p>' : ledger({ rows: lastExtrinsics })}
${sectionHead('Events', null, asOfTag(renderedAt))}
${lastEvents.length === 0 ? '<p class="nw-small nw-dim">No events in the blocks read.</p>' : ledger({ rows: lastEvents })}`;

  const pending =
    r === undefined || r.pending.value === null
      ? readingOf('Pending in the pool', r?.pending, () => '')
      : `${readingOf('Pending in the pool', r.pending, (pool) => formatInt(pool.length))}
${
  r.pending.value.length === 0
    ? ''
    : ledger({
        rows: r.pending.value.map((extrinsic) => ({
          id: extrinsic.hash,
          cells: ['', `<span class="nw-mono">${escapeHtml(shortHash(extrinsic.hash, 6))}</span>`, escapeHtml(`${extrinsic.section}.${extrinsic.method}`), extrinsic.signer ? addressChip(extrinsic.signer, { href: accountPath(extrinsic.signer) }) : '', tag({ state: 'live', text: 'PENDING · in the pool' })],
        })),
      })
}`;

  const body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><h1 class="nw-h3">${escapeHtml(view.chain.chain)}</h1>${asOfTag(renderedAt)}${tag({ state: 'record', text: `SPEC ${view.chain.specVersion} · ${view.chain.tokenSymbol}` })}</div>
${search}
${readings}
<p class="nw-small nw-dim">Head ${blockLinkByNumber(view.head.number)} ${blockLinkByHash(view.head.hash)} · <a href="${escapeHtml(activityPath())}">Agent activity</a></p>
<div class="nw-grid">
<div class="x-col-4">${sectionHead('Blocks', null, asOfTag(renderedAt))}${spineHtml}</div>
<div class="x-col-8">${ledgers}</div>
</div>
${pending}
</section>`;

  const indexerLine =
    view.indexer === undefined
      ? null
      : view.indexer.value === null
        ? `indexer api.scalarnet.io · <span class="nw-sage">unavailable · ${escapeHtml(view.indexer.reason ?? '')}</span>`
        : `indexer api.scalarnet.io · syncedHeight ${formatInt(view.indexer.value.syncedHeight)} · ${formatInt(
            Math.max(0, view.head.number - view.indexer.value.syncedHeight),
          )} behind`;

  return layout('Scalar Commons Explorer', {
    chain: view.chain,
    renderedAt,
    best: view.head.number,
    finalized: finalizedNumber,
    headAgeMs: r?.headAgeMs ?? null,
    indexerLine,
  }, body);
}

// ── block ────────────────────────────────────────────────────────────────────

/** A block, and the list of extrinsics that is the way through to everything else. */
export function renderBlock(view: BlockView, chain: ChainInfo): string {
  const d = view.detail;
  const renderedAt = d?.renderedAt ?? null;
  const best = d?.best ?? null;
  const headerSource = sourceAt('RPC', 'chain_getBlock', best, renderedAt);
  const finality =
    d === undefined || d.finalized.value === null
      ? tag({ state: 'record', text: 'FINALITY UNAVAILABLE' })
      : d.finalized.value
        ? tag({ state: 'sealed', text: 'FINALIZED' })
        : tag({ state: 'live', text: 'BEST · not final' });
  const prev = view.number > 0 ? quiet({ text: `← ${formatInt(view.number - 1)}`, href: blockPath({ kind: 'number', number: view.number - 1 }) }) : '';
  const next = best !== null && view.number < best ? quiet({ text: `${formatInt(view.number + 1)} →`, href: blockPath({ kind: 'number', number: view.number + 1 }) }) : '';

  const events = d?.events ?? view.extrinsics.flatMap((extrinsic) => (extrinsic.events ?? []).map((event) => ({ ...event, extrinsicIndex: extrinsic.index })));
  const counts = `${formatInt(view.extrinsics.length)} extrinsics · ${formatInt(events.length)} events`;

  const col = (html: string): string => `<div class="x-col-6">${html}</div>`;
  const receipts = `<div class="nw-grid">
${hashFact('Hash', view.hash, headerSource, { figureHtml: hashWithCopy(view.hash) })}
${hashFact('Parent', view.parentHash, headerSource, { href: blockPath({ kind: 'hash', hash: view.parentHash }) })}
${hashFact('State root', view.stateRoot, headerSource)}
${hashFact('Extrinsics root', view.extrinsicsRoot, headerSource)}
${col(fact('Time', formatTimestamp(view.timestampMs), sourceAt('STORAGE', 'timestamp.now', best, renderedAt)))}
${col(readingOf('Author', d?.author, (author) => author ?? 'not in the pre-digest', { size: 'body', figureHtml: (author) => (author ? addressChip(author, { href: accountPath(author) }) : '<span class="nw-sage">not in the pre-digest</span>') }))}
${col(readingOf('Slot', d?.slot, (slot) => slot ?? 'not in the pre-digest', { size: 'body' }))}
${col(
  d === undefined
    ? readingOf('Era · session', undefined, () => '')
    : reading({
        label: 'Era · session',
        figure: `${d.era.value === null ? 'unavailable' : formatInt(d.era.value)} · ${d.session.value === null ? 'unavailable' : formatInt(d.session.value)}`,
        size: 'body',
        sub: [d.era.reason, d.session.reason].filter((x): x is string => x !== null).join(' · ') || null,
        source: { ...d.era.source, url: 'agents.eraNumber · session.currentIndex' },
      }),
)}
${col(fact('Spec', String(view.specVersion), sourceAt('RPC', 'state_getRuntimeVersion', best, renderedAt)))}
${col(readingOf('Weight', d?.weight, (weight) => weight, { size: 'body', wide: true }))}
${col(fact('Counts', counts, headerSource))}
</div>`;

  const list =
    view.extrinsics.length === 0
      ? '<p class="nw-small nw-dim">This block has no extrinsics.</p>'
      : ledger({ sheet: true, rows: view.extrinsics.map((extrinsic) => extrinsicLedgerRow(view.number, extrinsic)) });

  const groups = new Map<number | null, (EventView & { extrinsicIndex: number | null })[]>();
  for (const event of events) {
    const key = event.extrinsicIndex;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const eventsHtml =
    events.length === 0
      ? `<p class="nw-small nw-dim">${d === undefined && view.extrinsics.every((e) => e.events === undefined) ? 'Events were not read in this view.' : 'No events were recorded in this block.'}</p>`
      : [...groups.entries()]
          .map(
            ([extrinsicIndex, group]) =>
              `<div class="nw-stack"><p class="nw-label">${
                extrinsicIndex === null
                  ? 'block hooks'
                  : `extrinsic <a href="${escapeHtml(extrinsicPath({ kind: 'number', number: view.number }, extrinsicIndex))}">${formatInt(view.number)}-${extrinsicIndex}</a>`
              }</p>${ledger({ rows: group.map((event) => eventLedgerRow(view.number, event)) })}</div>`,
          )
          .join('\n');

  const body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><span class="nw-label">Block</span><h1 class="nw-figure nw-figure--xl">${formatInt(view.number).replace(/,/g, '')}</h1>${finality}${asOfTag(renderedAt)}</div>
<p class="nw-small">${prev} ${next}</p>
${receipts}
${sectionHead('Extrinsics', view.extrinsics.length)}
${list}
${sectionHead('Events', events.length)}
${eventsHtml}
</section>`;

  return layout(`Block ${view.number}`, { chain, renderedAt, best, finalized: null, headAgeMs: null }, body);
}

// ── extrinsic ────────────────────────────────────────────────────────────────

/** One extrinsic, including the accounts it touched — the hop into the account view. */
export function renderExtrinsic(view: ExtrinsicView, chain: ChainInfo): string {
  const renderedAt = view.renderedAt ?? null;
  const src = sourceAt('RPC', 'chain_getBlock', view.block.number, renderedAt);
  const col = (html: string): string => `<div class="x-col-6">${html}</div>`;
  const callName = `${view.section}.${view.method}`;

  const receipts = `<div class="nw-grid">
${col(fact('Block', formatInt(view.block.number), src, { href: blockPath({ kind: 'number', number: view.block.number }) }))}
${hashFact('Block hash', view.block.hash, src)}
${col(fact('Index', `${formatInt(view.block.number)}-${view.index}`, src))}
${col(fact('Signer', '', src, { figureHtml: signerCell(view.isSigned, view.signer, 'unsigned (inherent)') }))}
${col(fact('Nonce', view.nonce === null ? '—' : String(view.nonce), src))}
${col(fact('Tip', view.tip === null ? '—' : formatBalance(view.tip, chain.tokenDecimals, chain.tokenSymbol), src))}
${col(fact('Length', `${formatInt(view.lengthBytes)} bytes`, src))}
</div>`;

  const callText =
    view.args.length === 0
      ? `${callName}()`
      : `${callName}(\n${view.args.map((arg) => `  ${arg.name}: ${arg.type} = ${arg.value}`).join(',\n')}\n)`;
  const callBlock = `${sectionHead('Call')}${code({ text: callText, lang: 'call' })}${rawDetails(view.args)}`;

  const accounts =
    view.accounts.length === 0
      ? '<p class="nw-small nw-dim">This extrinsic named no accounts.</p>'
      : `<ul class="nw-stack">${view.accounts.map((address) => `<li>${accountLink(address)}</li>`).join('')}</ul>`;

  const events =
    view.events.length === 0
      ? '<p class="nw-small nw-dim">No events were recorded for this extrinsic.</p>'
      : ledger({ rows: view.events.map((event) => eventLedgerRow(null, event)) });

  const terms = view.disputeTerms;
  const next =
    terms === undefined
      ? ''
      : `${sectionHead('What happens next')}${readingRow([
          readingOf('Dispute bounty', terms.bountyBps, (bps) => `${bps / 100}% · ${formatInt(bps)} bps`),
          readingOf('Burned on dispute', terms.burnBps, (bps) => `${bps / 100}% · ${formatInt(bps)} bps`),
          readingOf('Settled by', terms.settles, (who) => who, { size: 'body' }),
        ])}`;

  const body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><h1 class="nw-h2">${escapeHtml(callName)}</h1>${outcomeTag(view.outcome)}${asOfTag(renderedAt)}</div>
<p class="nw-mono x-hash">${hashWithCopy(view.hash)}</p>
${receipts}
${callBlock}
${sectionHead('Accounts touched', view.accounts.length)}
${accounts}
${sectionHead('Events', view.events.length)}
${events}
${next}
</section>`;

  return layout(`Extrinsic ${view.block.number}-${view.index}`, { chain, renderedAt, best: view.block.number, finalized: null, headAgeMs: null }, body);
}

// ── account ──────────────────────────────────────────────────────────────────

/** An account: the state the runtime holds for it, at the block it was read. */
export function renderAccount(view: AccountView, chain: ChainInfo): string {
  const roles = view.roles;
  const renderedAt = roles?.renderedAt ?? null;
  const balanceSource = sourceAt('STORAGE', 'system.account', view.at.number, renderedAt);

  const name = roles?.agentName.value ?? null;
  const operator = name !== null && name.startsWith('swarm-');
  const isAgent = name !== null || (roles?.agentStake.value ?? null) !== null;
  // DECAYED: the head is past the agent's heartbeat by more than the runtime's
  // grace period, where the pallet's decay begins (the rule and both bounds
  // are the chain's; the multiplier it implies is on the receipt).
  const heartbeat = roles?.heartbeat?.value ?? null;
  const multiplier = heartbeat === null ? null : heartbeatMultiplier(heartbeat);
  const tags = [
    roles?.validator.value === true ? tag({ state: 'record', text: 'VALIDATOR STASH' }) : '',
    (roles?.bonded.value ?? null) !== null ? tag({ state: 'record', text: 'BONDED' }) : '',
    isAgent ? tag({ state: 'record', text: 'AGENT' }) : '',
    operator ? tag({ state: 'operator', text: 'OPERATOR-RUN' }) : '',
    heartbeat !== null && heartbeatDecayed(heartbeat) ? tag({ state: 'record', text: 'DECAYED' }) : '',
  ].join('');

  const figureOf = (value: bigint): string => tokenFigure(value, chain.tokenDecimals, chain.tokenSymbol);
  const unit = chain.tokenSymbol;
  const balances = readingRows([
    fact('Free', figureOf(view.free), balanceSource, { size: 'm', unit }),
    fact('Reserved', figureOf(view.reserved), balanceSource, { size: 'm', unit }),
    fact('Frozen', figureOf(view.frozen), balanceSource, { size: 'm', unit }),
    fact('Total', figureOf(view.free + view.reserved), { ...balanceSource, computed: 'free + reserved' }, { size: 'm', unit }),
  ]);

  const col = (html: string): string => `<div class="x-col-6">${html}</div>`;
  const roleReadings = isAgent
    ? `${sectionHead('Agent')}<div class="nw-grid">
${col(readingOf('Name', roles?.agentName, (n) => n ?? 'no metadata on chain', { size: 'body', figureHtml: (n) => (n ? agentName({ name: n, operator: n.startsWith('swarm-') }) : '<span class="nw-sage">no metadata on chain</span>') }))}
${col(readingOf('Stake', roles?.agentStake, (stake) => (stake === null ? 'none' : figureOf(stake)), { unit: (roles?.agentStake.value ?? null) === null ? null : unit }))}
${
  roles?.heartbeat === undefined || (roles.heartbeat.value === null && roles.heartbeat.reason === null)
    ? ''
    : col(
        readingOf(
          'Last heartbeat',
          roles.heartbeat.value === null
            ? roles.heartbeat
            : {
                ...roles.heartbeat,
                source: {
                  ...roles.heartbeat.source,
                  computed: `best ${roles.heartbeat.value.best} − ${roles.heartbeat.value.lastHeartbeat} = ${roles.heartbeat.value.best - roles.heartbeat.value.lastHeartbeat} blocks · grace ${roles.heartbeat.value.grace} · decay ${roles.heartbeat.value.decay} · multiplier ${multiplier ?? 100} % (pallets/agents/src/lib.rs:1987)`,
                },
              },
          (h) => (h === null ? '' : formatInt(h.lastHeartbeat)),
          { href: heartbeat === null ? null : blockPath({ kind: 'number', number: heartbeat.lastHeartbeat }) },
        ),
      )
}
</div>`
    : `${sectionHead('Staking')}<div class="nw-grid">
${col(readingOf('Bonded', roles?.bonded, (controller) => controller ?? 'not bonded', { size: 'body' }))}
${col(readingOf('Validator', roles?.validator, (v) => (v ? 'in session.validators' : 'not in session.validators'), { size: 'body' }))}
</div>`;

  const history = view.history;
  const entries: RailEntry[] =
    history?.value?.map((row, position) => ({
      time: row.timestampMs === null ? `block ${formatInt(row.blockNumber)}` : (utc(formatTimestamp(row.timestampMs)) ?? ''),
      state: position === 0 ? 'newest' : row.success === false ? 'dispute' : 'final',
      html: `<a href="${escapeHtml(extrinsicPath({ kind: 'number', number: row.blockNumber }, row.index))}">${escapeHtml(`${row.section}.${row.method}`)}</a> <span class="nw-label">${formatInt(row.blockNumber)}-${row.index}</span>`,
    })) ?? [];
  const historyHtml =
    history === undefined
      ? readingOf('History', undefined, () => '')
      : history.value === null
        ? readingOf('History', history, () => '')
        : entries.length === 0
          ? '<p class="nw-small nw-dim">No activity in the index for this address.</p>'
          : rail({ entries });

  const body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><h1 class="nw-h2">${name === null ? escapeHtml(view.address) : agentName({ name, operator })}</h1>${tags}${asOfTag(renderedAt)}</div>
<p class="nw-mono x-hash">${hashWithCopy(view.address)}</p>
${balances}
${roleReadings}
<div class="nw-grid">
${hashFact('Public key', view.publicKey, balanceSource)}
${col(fact('Nonce', String(view.nonce), balanceSource))}
${hashFact('State read at', `${formatInt(view.at.number)}`, sourceAt('RPC', 'chain_getHeader', view.at.number, renderedAt), { href: blockPath({ kind: 'number', number: view.at.number }), figureHtml: `${formatInt(view.at.number)} <span class="nw-mono">${escapeHtml(view.at.hash)}</span>` })}
</div>
${sectionHead('History', null, filter([{ href: accountPath(view.address), label: 'all', current: true }, { href: activityPath(view.address), label: 'agent activity' }]))}
${historyHtml}
</section>`;

  return layout(name ?? 'Account', { chain, renderedAt, best: view.at.number, finalized: null, headAgeMs: null }, body);
}

// ── activity ─────────────────────────────────────────────────────────────────

/**
 * How often the newest page of the activity feed reloads itself.
 *
 * Two block times: the indexer only follows finalized blocks, so reloading
 * faster than blocks finalize would mostly redraw the same rows.
 */
export const ACTIVITY_REFRESH_SECONDS = 12;

/** The indexer's kind names, as a reader would say them. Unknown kinds are shown as served. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  message: 'message',
  registration: 'registration',
  heartbeat: 'heartbeat',
  agreement: 'agreement',
  dispute: 'dispute',
  oracle_vote: 'oracle vote',
  slash: 'slash',
};

const KIND_STATES: Readonly<Record<string, State>> = { dispute: 'dispute', slash: 'slashed' };

function kindTag(kind: string): string {
  return tag({ state: KIND_STATES[kind] ?? 'record', text: (KIND_LABELS[kind] ?? kind).toUpperCase() });
}

/** An agent: a link to their own activity, plus the hop into their account view. */
function agentLink(address: string): string {
  return `<a class="nw-mono" href="${escapeHtml(activityPath(address))}">${escapeHtml(address)}</a> <a href="${escapeHtml(accountPath(address))}" title="account">↗</a>`;
}

function activityFieldValue(field: ActivityField, chain: ChainInfo): string {
  switch (field.kind) {
    case 'account':
      return `<a class="nw-mono" href="${escapeHtml(activityPath(field.value))}">${escapeHtml(field.value)}</a>`;
    case 'balance':
      return escapeHtml(formatBalance(BigInt(field.value), chain.tokenDecimals, chain.tokenSymbol));
    case 'plain':
      return escapeHtml(field.value);
  }
}

function activityRow(entry: ActivityEntry, chain: ChainInfo): LedgerRow {
  const where =
    entry.extrinsicIndex === null
      ? blockLinkByNumber(entry.blockNumber)
      : `${blockLinkByNumber(entry.blockNumber)} · <a href="${escapeHtml(extrinsicPath({ kind: 'number', number: entry.blockNumber }, entry.extrinsicIndex))}">${entry.blockNumber}-${entry.extrinsicIndex}</a>`;
  const fields = entry.fields.map((field) => `${escapeHtml(field.name)}: ${activityFieldValue(field, chain)}`).join('<br>');
  const agents = entry.agents.length === 0 ? '<span class="nw-sage">none named</span>' : entry.agents.map(agentLink).join('<br>');
  return {
    id: entry.id,
    cells: [
      `${escapeHtml(entry.id)}<br>${escapeHtml(formatTimestamp(entry.timestampMs))}`,
      `${where}<br>${escapeHtml(`${entry.section}.${entry.method}`)}`,
      `${kindTag(entry.kind)}<br>${fields === '' ? '<span class="nw-sage">—</span>' : fields}`,
      agents,
      '',
    ],
  };
}

const activityRailEntry = (entry: ActivityEntry, chain: ChainInfo, position: number): RailEntry => ({
  time: formatTimestamp(entry.timestampMs) === 'unknown' ? `block ${formatInt(entry.blockNumber)}` : (utc(formatTimestamp(entry.timestampMs)) ?? ''),
  state: position === 0 ? 'newest' : entry.kind === 'dispute' ? 'dispute' : entry.kind === 'slash' ? 'slash' : 'final',
  html: activityRow(entry, chain).cells.slice(0, 3).join(' · '),
});

/**
 * The agent-activity feed: one stream of what agents did, newest first.
 *
 * The newest page reloads itself; an older page does not, because a reader
 * paging back through history is reading, and a reload would shift the window
 * under them as new rows push the old ones down.
 */
export function renderActivity(view: ActivityView, chain: ChainInfo): string {
  const agentReadings = view.agentReadings;
  const renderedAt = agentReadings?.renderedAt ?? null;
  const balance = (value: bigint): string => formatBalance(value, chain.tokenDecimals, chain.tokenSymbol);

  const form = `<form class="nw-search" method="get" action="/activity">${field({
    name: 'agent',
    label: 'Filter by agent address (SS58)',
    placeholder: 'agent address (SS58)',
    value: view.agent ?? '',
  })}</form>`;

  const reach =
    view.historyFrom === null
      ? 'The indexer holds no blocks yet.'
      : `History reaches back to block ${view.historyFrom}, the oldest the indexer holds.`;
  const live = view.offset === 0 ? ` This page refreshes every ${ACTIVITY_REFRESH_SECONDS}s.` : '';
  const empty = `<p class="nw-small nw-dim">No agent activity ${view.offset > 0 ? 'this far back' : 'in the indexed history'}${
    view.agent === null ? '' : ' for this agent'
  }.</p>`;

  const paging = pager({
    from: view.total === 0 ? 0 : view.offset + 1,
    to: Math.min(view.total, view.offset + view.entries.length),
    total: view.total,
    prevHref: view.offset > 0 ? activityPath(view.agent) : null,
    nextHref: view.offset + view.entries.length < view.total ? activityPath(view.agent, view.offset + view.limit) : null,
  });

  const receiptLine = `<p class="nw-small nw-dim">Activity read from the indexer's index of finalized blocks; field types from the node's runtime metadata. ${escapeHtml(reach)}${live}</p>`;

  let body: string;
  if (view.agent === null || agentReadings === undefined) {
    const scope =
      view.agent === null
        ? 'every agent'
        : `<span class="nw-mono">${escapeHtml(view.agent)}</span> (<a href="${escapeHtml(accountPath(view.agent))}">account</a> · <a href="${escapeHtml(activityPath())}">show every agent</a>)`;
    body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><h1 class="nw-h2">Agent activity</h1>${asOfTag(renderedAt)}</div>
<p class="nw-small">Showing ${scope}: ${view.total} event${view.total === 1 ? '' : 's'}, newest first.</p>
${form}
${view.entries.length === 0 ? empty : ledger({ rows: view.entries.map((entry) => activityRow(entry, chain)) })}
${paging}
${receiptLine}
</section>`;
  } else {
    const a = agentReadings;
    const name = a.name;
    const operator = name !== null && name.startsWith('swarm-');
    const stateTags = [a.decayed ? tag({ state: 'record', text: 'DECAYED' }) : '', a.cooldown ? tag({ state: 'record', text: 'COOLDOWN' }) : ''].join('');
    const readings = `<div class="nw-row x-wrap">
${readingOf('Earned all time', a.earnedAllTime, (v) => (v === null ? '' : balance(v)))}
${readingOf('Earned this era', a.earnedThisEra, (v) => (v === null ? '' : balance(v)))}
${readingOf('Agreements open', a.agreementsOpen, (v) => (v === null ? '' : formatInt(v)))}
${readingOf('In dispute', a.inDispute, (v) => (v === null ? '' : formatInt(v)), { state: (a.inDispute.value ?? 0) > 0 ? 'dispute' : 'record' })}
${readingOf('Counterparties', a.counterparties, (v) => formatInt(v.length))}
</div>`;

    const series = a.earningsByEra.value;
    let curveHtml: string;
    if (series === null) {
      curveHtml = readingOf('Earnings by era', a.earningsByEra, () => '');
    } else {
      const ordered = [...series].sort((x, y) => x.era - y.era);
      const values = ordered.map((row) => Number(row.amount) / 10 ** chain.tokenDecimals);
      const paths = curvePaths(values, 1200, 200);
      const table = ordered.map((row) => [`era ${formatInt(row.era)}`, balance(row.amount)]);
      curveHtml =
        paths === null
          ? `<p class="nw-small nw-dim">${ordered.length === 0 ? 'No settled era with earnings in the index for this agent.' : `One era in the index: era ${formatInt(ordered[0]?.era ?? 0)} · ${balance(ordered[0]?.amount ?? 0n)}.`}</p>`
          : curve({
              id: 'earnings',
              width: 1200,
              height: 200,
              pathLine: paths.pathLine,
              pathArea: paths.pathArea,
              end: paths.end,
              labels: [balance(ordered.reduce((m, r) => (r.amount > m ? r.amount : m), 0n)), '', balance(0n)],
              alt: `Earnings by era for ${name ?? view.agent}, ${ordered.length} eras`,
              table,
            });
    }

    const counterparties = a.counterparties.value ?? [];
    const most = counterparties.reduce((m, c) => Math.max(m, c.count), 0);
    const counterpartyRows: LedgerRow[] = counterparties.map((c) => ({
      id: c.address,
      cells: [
        String(c.count),
        addressChip(c.address, { href: activityPath(c.address) }),
        `<span class="nw-share" style="width:${most === 0 ? 0 : Math.round((c.count / most) * 100)}%"></span>`,
        '',
        '',
      ],
    }));

    body = `<section class="nw-section nw-stack">
<div class="nw-section-head"><h1 class="nw-h2">${name === null ? escapeHtml(view.agent) : agentName({ name, operator })}</h1>${stateTags}${asOfTag(renderedAt)}</div>
<p class="nw-small"><span class="nw-mono">${escapeHtml(view.agent)}</span> (<a href="${escapeHtml(accountPath(view.agent))}">account</a> · <a href="${escapeHtml(activityPath())}">show every agent</a>)</p>
${form}
${readings}
${sectionHead('Earnings by era', null, asOfTag(renderedAt))}
${curveHtml}
${sectionHead('Counterparties', counterparties.length)}
${counterpartyRows.length === 0 ? readingOf('Counterparties', a.counterparties, () => 'none in the index') : ledger({ rows: counterpartyRows })}
${sectionHead('Watch-log', view.total)}
${view.entries.length === 0 ? empty : rail({ entries: view.entries.map((entry, position) => activityRailEntry(entry, chain, position)) })}
${paging}
${receiptLine}
</section>`;
  }

  return layout(
    'Agent activity',
    {
      chain,
      renderedAt,
      best: null,
      finalized: null,
      headAgeMs: null,
      ...(view.offset === 0 ? { refreshSeconds: ACTIVITY_REFRESH_SECONDS } : {}),
    },
    body,
  );
}

// ── errors ───────────────────────────────────────────────────────────────────

/** An error page as a Band. The reason is chain- or user-supplied, so it is escaped like any other value. */
export function renderError(status: number, message: string, chain: ChainInfo | null): string {
  const body = `<section class="nw-section nw-stack">
<p class="nw-figure nw-figure--xl nw-sage">${status}</p>
${band({ text: `${status} · ${message}`, alarm: status >= 500 })}
<p class="nw-small"><a href="/">Explorer home</a></p>
</section>`;
  return layout(`${status}`, { chain, renderedAt: null, best: null, finalized: null, headAgeMs: null }, body);
}
