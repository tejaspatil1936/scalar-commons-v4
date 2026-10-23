/**
 * Nightwatch — the chrome's templates, ported to TypeScript for the explorer.
 *
 * A line-for-line mirror of `landing/src/chrome/templates.mjs`: the same
 * markup and the same class names, so `chrome.css` (the synced, byte-identical
 * copy under `src/chrome/`) draws the explorer exactly as it draws the landing.
 * Pure functions returning strings: no DOM, no clock, no network. Every figure
 * is a Reading, and a Reading without a `source` throws at render time, so the
 * server fails a request rather than ship a figure that names no origin.
 *
 * The one deliberate difference from the landing: the explorer is a server
 * that renders at request time, so the head links the stylesheet it serves at
 * `/chrome.css` instead of inlining it, and font preloads are absolute (a page
 * lives under `/block/…`, so a relative `fonts/…` would miss).
 */

import { escapeHtml } from './format.js';
import type { Source } from './types.js';

export { escapeHtml };
export type { Source };

export const SITE_NAME = 'Scalar Commons';
export const DISCLAIMER = 'Testnet — the token has no value and the chain may be reset.';
export const SITE_ORIGIN = 'https://scalarnet.io/';
export const EXPLORER_ORIGIN = 'https://explorer.scalarnet.io';
export const DOCS_URL = 'https://scalarnet.io/docs/';
export const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4';
export const API_HOST = 'api.scalarnet.io';
export const RPC_WSS = 'wss://rpc.scalarnet.io';

/** The site nav, in the brief's order. The explorer is served from its own origin, so every href is absolute. */
export const NAV: readonly { readonly key: string; readonly label: string; readonly href: string }[] = [
  { key: 'observatory', label: 'Observatory', href: `${SITE_ORIGIN}observatory` },
  { key: 'pulse', label: 'Pulse', href: `${SITE_ORIGIN}pulse` },
  { key: 'explorer', label: 'Explorer', href: EXPLORER_ORIGIN },
  { key: 'docs', label: 'Docs', href: DOCS_URL },
  { key: 'oversight', label: 'Oversight', href: `${SITE_ORIGIN}oversight` },
  { key: 'faucet', label: 'Faucet', href: `${SITE_ORIGIN}faucet` },
];

/** The states a stub, a tag or a reading can be in, each with the word the brief pairs it with. */
export const STATE_WORDS: Readonly<Record<string, string>> = {
  live: 'LIVE',
  record: 'RECORD',
  sealed: 'SEALED',
  connecting: 'CONNECTING',
  dispute: 'IN DISPUTE',
  slashed: 'SLASHED',
  operator: 'OPERATOR-RUN',
  built: 'AS BUILT',
};

export type State = 'live' | 'record' | 'sealed' | 'connecting' | 'dispute' | 'slashed' | 'operator' | 'built' | 'kbd';

type AttrValue = string | number | boolean | null | undefined;

/** Attribute string from an object; `null`/`false` omit the attribute, `true` renders it bare. */
export const attrs = (object: Record<string, AttrValue>): string =>
  Object.entries(object)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(String(v))}"`))
    .join('');

// ── atoms ────────────────────────────────────────────────────────────────────

export function leader({ arrow = false }: { arrow?: boolean } = {}): string {
  return `<span class="nw-leader${arrow ? ' nw-leader--arrow' : ''}" aria-hidden="true"></span>`;
}

/** `GET api.scalarnet.io/v1/status` style request line for a source. */
export function requestLine(source: Source): string {
  const url = String(source.url).replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
  return `${source.method} ${url}`;
}

/** UTC to the second, the way every receipt prints time. */
export const utc = (iso: string | null | undefined): string | null =>
  iso ? String(iso).replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/Z$/, ' UTC') : null;

const groups = new Intl.NumberFormat('en-US');
export const formatInt = (n: number | bigint | string): string =>
  groups.format(typeof n === 'bigint' ? n : Number(n));

/**
 * The receipt under a figure: the request, when and at which block it was
 * fetched, the raw bytes, and the computation when the figure is derived.
 */
export function receipt(source: Source): string {
  const fetched = source.fetchedAt ? utc(source.fetchedAt) : '—';
  const block = source.block === null || source.block === undefined ? '—' : `block ${formatInt(source.block)}`;
  const raw = source.raw ? `<a href="${escapeHtml(source.raw)}" data-raw>raw ↗</a>` : '<span data-raw>raw —</span>';
  const computed = source.computed ? `<div data-computed>${escapeHtml(source.computed)}</div>` : '';
  return `<div class="nw-receipt" data-receipt><div data-request>${escapeHtml(requestLine(source))}</div><div data-fetched>fetched ${escapeHtml(fetched ?? '—')} · ${escapeHtml(block)}</div><div>${raw}</div>${computed}</div>`;
}

export function receiptLine(source: Source): string {
  const fetched = source.fetchedAt ? utc(source.fetchedAt) : '—';
  const block = source.block === null || source.block === undefined ? '' : ` · block ${formatInt(source.block)}`;
  return `<span class="nw-receipt-line" data-receipt-line>${escapeHtml(requestLine(source))} · ${escapeHtml(fetched ?? '—')}${escapeHtml(block)}</span>`;
}

export function stub({
  state = 'record',
  sealed = false,
  label = null,
}: { state?: State; sealed?: boolean; label?: string | null } = {}): string {
  const word = STATE_WORDS[state] ?? state;
  const tag = sealed ? 'span' : 'button';
  return `<${tag} class="nw-stub"${attrs({
    type: sealed ? null : 'button',
    'data-state': state,
    'data-sealed': sealed ? 'true' : null,
    'aria-label': label ?? `${word} · show the source`,
    'aria-expanded': sealed ? null : 'false',
  })}></${tag}>`;
}

export interface ReadingOptions {
  readonly key?: string | null;
  readonly label: string;
  /** Already formatted; null renders an empty figure (a leader to nothing). */
  readonly figure?: string | null;
  readonly size?: 'xl' | 'l' | 'm' | 's' | 'body';
  readonly state?: State;
  readonly sealed?: boolean;
  readonly source: Source;
  readonly sub?: string | null;
  readonly href?: string | null;
  readonly live?: boolean;
  readonly className?: string;
  readonly unit?: string | null;
  readonly stack?: boolean;
  readonly id?: string | null;
  /** Pre-escaped markup for the figure, when it is a link or an address rather than text. */
  readonly figureHtml?: string | null;
}

/**
 * The Reading. `figure` is a string already formatted (or null when the read
 * failed or the index does not carry the field — a leader to nothing), `size`
 * one of xl | l | m | s | body (inside an `.nw-row` the row's count sets it), `state` the stub's state, `source` the origin —
 * required. `sub` is the optional sub-line, `href` wraps the figure in a link.
 */
export function reading({
  key = null,
  label,
  figure = null,
  size = 'm',
  state = 'record',
  sealed = false,
  source,
  sub = null,
  href = null,
  live = false,
  className = '',
  unit = null,
  stack = false,
  id = null,
  figureHtml = null,
}: ReadingOptions): string {
  if (!source || !source.method || !source.url) {
    throw new Error(
      `Reading "${label ?? key}" has no source: every figure names its origin {method, url, fetchedAt, block, raw}`,
    );
  }
  const loading = live && figure === null;
  const classes = ['nw-reading', stack ? 'nw-reading--stack' : '', loading ? 'is-loading' : '', className]
    .filter(Boolean)
    .join(' ');
  const figureText = figureHtml ?? (figure === null ? '' : escapeHtml(figure));
  const unitHtml = unit ? `<span class="nw-unit">${escapeHtml(unit)}</span>` : '';
  const figureInner = `<span class="nw-figure nw-figure--${escapeHtml(size)}" data-reading-value${
    live ? ' aria-live="polite" aria-atomic="true"' : ''
  }>${figureText}${unitHtml}</span>`;
  const figureMarkup = href ? `<a href="${escapeHtml(href)}">${figureInner}</a>` : figureInner;
  return `<div class="${classes}"${attrs({ 'data-reading': key, 'data-sealed': sealed ? 'true' : null, id })}>
  <div class="nw-reading-line"><span class="nw-label">${escapeHtml(label)}</span>${leader()}<span class="nw-reading-figure">${figureMarkup}${stub({ state, sealed })}</span></div>
  ${sub ? `<p class="nw-reading-sub" data-reading-sub>${escapeHtml(sub)}</p>` : ''}${receiptLine(source)}
  ${receipt(source)}
</div>`;
}

/**
 * A tag: the state word on paper-2, with the stub's mark before it (solid,
 * outline, hatch, X, double ring) for every state but a key — AS BUILT and
 * AS OF included, so a state is never carried by the word's colour alone.
 */
export function tag({ state = 'record', text, detail = null }: { state?: State; text: string; detail?: string | null }): string {
  const dot = state === 'kbd' ? '' : '<span class="nw-dot" aria-hidden="true"></span>';
  // The detail (a time, a block) is the part a narrow bar may hide; the word stays.
  const tail = detail === null ? '' : `<span class="nw-tag-detail"> · ${escapeHtml(detail)}</span>`;
  return `<span class="nw-tag" data-state="${escapeHtml(state)}">${dot}${escapeHtml(text)}${tail}</span>`;
}

/** The lamp, unlit and connecting — the landing's form, where the client fills it. */
export function lamp({ rpc = RPC_WSS }: { rpc?: string } = {}): string {
  return `<span class="nw-lamp" data-lamp data-state="connecting" data-lit="false" role="status" aria-live="off"><span class="nw-lamp-dot" aria-hidden="true"></span><span class="nw-lamp-text nw-label">connecting · ${escapeHtml(rpc)}</span></span>`;
}

/**
 * The lamp as the server fills it at request time: `block n · fin k`. Lit
 * only when the newest block was authored under 30 s before the render (the
 * lamp rule); otherwise unlit, and `stalled` names the last block's time.
 * `alarm` is the part printed in ink at weight 500 (index −n).
 */
export function lampFilled({
  state,
  lit,
  text,
  alarm = null,
}: {
  state: 'normal' | 'connecting' | 'lagging' | 'stalled' | 'behind';
  lit: boolean;
  text: string;
  alarm?: string | null;
}): string {
  const alarmHtml = alarm ? ` · <span class="nw-alarm">${escapeHtml(alarm)}</span>` : '';
  return `<span class="nw-lamp" data-lamp data-state="${escapeHtml(state)}" data-lit="${lit ? 'true' : 'false'}" role="status" aria-live="off"><span class="nw-lamp-dot" aria-hidden="true"></span><span class="nw-lamp-text nw-label">${escapeHtml(text)}${alarmHtml}</span></span>`;
}

export function sourcesSwitch(): string {
  return `<button type="button" class="nw-sources nw-label" role="switch" aria-checked="false" data-sources-switch><span class="nw-sources-word">Sources</span><span class="nw-switch" aria-hidden="true"></span></button>`;
}

export function button({
  text,
  type = 'button',
  className = '',
  disabled = false,
  name = null,
}: {
  text: string;
  type?: 'button' | 'submit';
  className?: string;
  disabled?: boolean;
  name?: string | null;
}): string {
  return `<button class="nw-button ${className}"${attrs({ type, disabled, name })}>${escapeHtml(text)}<span class="nw-dots" aria-hidden="true" hidden><span></span><span></span><span></span></span></button>`;
}

export const quiet = ({
  text,
  href = null,
  className = '',
  attrsExtra = {},
}: {
  text: string;
  href?: string | null;
  className?: string;
  attrsExtra?: Record<string, AttrValue>;
}): string =>
  href
    ? `<a class="nw-quiet ${className}" href="${escapeHtml(href)}"${attrs(attrsExtra)}>${escapeHtml(text)}</a>`
    : `<button type="button" class="nw-quiet ${className}"${attrs(attrsExtra)}>${escapeHtml(text)}</button>`;

export function field({
  name,
  label,
  placeholder = '',
  value = '',
  type = 'text',
  autocomplete = 'off',
}: {
  name: string;
  label: string;
  placeholder?: string;
  value?: string;
  type?: string;
  autocomplete?: string;
}): string {
  return `<label class="nw-label" for="field-${escapeHtml(name)}">${escapeHtml(label)}</label><input class="nw-field"${attrs(
    { id: `field-${name}`, name, type, placeholder, value, autocomplete, spellcheck: 'false' },
  )}><span class="nw-field-error" data-field-error hidden></span>`;
}

export const filter = (items: readonly { href: string; label: string; current?: boolean }[]): string =>
  `<nav class="nw-filter nw-label">${items
    .map((i) => `<a href="${escapeHtml(i.href)}"${i.current ? ' aria-current="true"' : ''}>${escapeHtml(i.label)}</a>`)
    .join('')}</nav>`;

export const pager = ({
  from,
  to,
  total,
  nextHref = null,
  prevHref = null,
}: {
  from: number;
  to: number;
  total: number;
  nextHref?: string | null;
  prevHref?: string | null;
}): string =>
  `<nav class="nw-pager nw-label" aria-label="Pages">${
    prevHref ? `<a href="${escapeHtml(prevHref)}">← previous</a>` : ''
  }<span>${formatInt(from)}–${formatInt(to)} of ${formatInt(total)}</span>${
    nextHref ? `<a href="${escapeHtml(nextHref)}">next →</a>` : ''
  }</nav>`;

export const copy = (value: string, label = 'Copy'): string =>
  `<button type="button" class="nw-copy nw-label" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}">Copy</button>`;

// ── compounds ────────────────────────────────────────────────────────────────

export function code({ text, copyable = true, lang = null }: { text: string; copyable?: boolean; lang?: string | null }): string {
  return `<figure class="nw-code nw-copyable"${attrs({ 'data-lang': lang })}><pre><code>${escapeHtml(text)}</code></pre>${
    copyable ? copy(text, 'Copy this block') : ''
  }</figure>`;
}

export const raw = (json: unknown): string =>
  `<pre class="nw-raw">${escapeHtml(typeof json === 'string' ? json : JSON.stringify(json, null, 1))}</pre>`;

export function address(full: string, { href = null }: { href?: string | null } = {}): string {
  const short = `${full.slice(0, 6)}…${full.slice(-4)}`;
  const inner = `<span class="nw-address-full nw-mono">${escapeHtml(full)}${copy(full, 'Copy address')}</span>`;
  return href
    ? `<a class="nw-address" href="${escapeHtml(href)}">${escapeHtml(short)}${inner}</a>`
    : `<span class="nw-address">${escapeHtml(short)}${inner}</span>`;
}

export function agentName({
  name,
  href = null,
  operator = false,
  dispute = false,
}: {
  name: string;
  href?: string | null;
  operator?: boolean;
  dispute?: boolean;
}): string {
  const classes = ['nw-agent', operator ? 'is-operator' : '', dispute ? 'is-dispute' : ''].filter(Boolean).join(' ');
  return href
    ? `<a class="${classes}" href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
    : `<span class="${classes}">${escapeHtml(name)}</span>`;
}

export interface LedgerRow {
  /** Pre-escaped cell markup: [index, hash, call, signer, state]. */
  readonly cells: readonly string[];
  readonly selected?: boolean;
  readonly id?: string | null;
}

/** `rows`: [{cells: [index, hash, call, signer, state], selected?}]; `head`: column words. */
export function ledger({
  rows,
  head = null,
  sheet = false,
  className = '',
}: {
  rows: readonly LedgerRow[];
  head?: readonly string[] | null;
  sheet?: boolean;
  className?: string;
}): string {
  const headHtml = head
    ? `<li class="nw-ledger-row nw-ledger-head nw-label" role="row">${head.map((h) => `<span>${escapeHtml(h)}</span>`).join('')}</li>`
    : '';
  const cellClasses = ['nw-ledger-index nw-label', 'nw-mono', 'nw-ledger-call', 'nw-ledger-signer nw-mono', ''];
  const body = rows
    .map(
      (row) =>
        `<li class="nw-ledger-row"${attrs({ 'aria-selected': row.selected ? 'true' : null, 'data-id': row.id })}>${row.cells
          .map((c, i) => `<span class="${cellClasses[i] ?? ''}">${c}</span>`)
          .join('')}</li>`,
    )
    .join('\n');
  return `<ol class="nw-ledger${sheet ? ' nw-ledger--sheet' : ''} ${className}" role="table">${headHtml}${body}</ol>`;
}

export interface RailEntry {
  readonly time: string;
  readonly text?: string;
  /** Pre-escaped markup, used instead of `text` when given. */
  readonly html?: string;
  readonly state?: 'newest' | 'final' | 'dispute' | 'slash' | null;
}

/** `entries`: [{time, text|html, state}] newest first. */
export function rail({ entries, className = '' }: { entries: readonly RailEntry[]; className?: string }): string {
  return `<ol class="nw-rail ${className}">${entries
    .map(
      (e) =>
        `<li class="nw-rail-entry"><span class="nw-rail-tick${e.state ? ` is-${escapeHtml(e.state)}` : ''}" aria-hidden="true"></span><span class="nw-rail-time nw-label">${escapeHtml(e.time)}</span><div>${e.html ?? escapeHtml(e.text ?? '')}</div></li>`,
    )
    .join('')}</ol>`;
}

export interface SpineTick {
  readonly number: number;
  readonly final?: boolean;
  readonly newest?: boolean;
  readonly label?: string | null;
  /** Pre-escaped markup for the explorer form's columns. */
  readonly html?: string;
}

/** The Spine: `ticks` newest first. `form`: margin | explorer | comb. */
export function spine({
  ticks,
  form = 'margin',
  ariaLabel = null,
}: {
  ticks: readonly SpineTick[];
  form?: 'margin' | 'explorer' | 'comb';
  ariaLabel?: string | null;
}): string {
  return `<ol class="nw-spine nw-spine--${escapeHtml(form)}" data-spine role="img"${attrs({ 'aria-label': ariaLabel })}>${ticks
    .map(
      (t) =>
        `<li class="nw-spine-tick${t.final ? ' is-final' : ''}${t.newest ? ' is-newest' : ''}"${attrs({ 'data-block': t.number })}>${
          t.label ? `<span class="nw-spine-number nw-label">${escapeHtml(t.label)}</span>` : ''
        }${t.html ?? ''}</li>`,
    )
    .join('')}</ol>`;
}

/**
 * The Curve, as an SVG string. The explorer has no d3, so `pathLine` and
 * `pathArea` are computed by `curvePaths` below (straight segments). In the
 * Ledger the pool beneath the line is a flat ink tint (no gradient), drawn by
 * chrome.css, as in the landing's template.
 */
export function curve({
  id,
  width = 400,
  height = 120,
  pathLine,
  pathArea,
  labels = [],
  end = null,
  ticks = [],
  alt,
  table = null,
}: {
  id: string;
  width?: number;
  height?: number;
  pathLine: string;
  pathArea: string;
  labels?: readonly string[];
  end?: readonly [number, number] | null;
  ticks?: readonly { x: number; state?: string }[];
  alt: string;
  table?: readonly (readonly string[])[] | null;
}): string {
  const labelHtml = labels
    .map(
      (l, i) =>
        `<text class="nw-curve-value" x="0" y="${12 + i * ((height - 12) / Math.max(1, labels.length - 1))}">${escapeHtml(l)}</text>`,
    )
    .join('');
  // Event ticks on the baseline: a dispute is a dashed tick, a slash an X,
  // each with its word beside it — the state is never a colour.
  const tickHtml = ticks
    .map((t) => {
      const st = escapeHtml(t.state ?? 'settled');
      const word = t.state === 'dispute' ? 'dispute' : t.state === 'slash' ? 'slash' : null;
      const mark =
        t.state === 'slash'
          ? `<line class="nw-curve-tick" data-state="slash" x1="${t.x - 3}" x2="${t.x + 3}" y1="${height - 6}" y2="${height}"></line><line class="nw-curve-tick" data-state="slash" x1="${t.x - 3}" x2="${t.x + 3}" y1="${height}" y2="${height - 6}"></line>`
          : `<line class="nw-curve-tick" data-state="${st}" x1="${t.x}" x2="${t.x}" y1="${height - 6}" y2="${height}"></line>`;
      return word ? `${mark}<text class="nw-curve-word" x="${t.x + 6}" y="${height - 1}">${word}</text>` : mark;
    })
    .join('');
  const endHtml = end ? `<circle class="nw-curve-end" cx="${end[0]}" cy="${end[1]}" r="3"></circle>` : '';
  const tableHtml = table
    ? `<table><tbody>${table.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
  return `<figure class="nw-curve" data-curve="${escapeHtml(id)}"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(alt)}"><path class="nw-curve-pool" d="${pathArea}"></path><path class="nw-curve-line" d="${pathLine}"></path>${labelHtml}${tickHtml}${endHtml}</svg>${tableHtml}</figure>`;
}

/**
 * Straight-segment line and area paths for the Curve from `values` (one per
 * x step, oldest first), scaled into `width` × `height` with the baseline at
 * the bottom. Returns null for fewer than two values: no line can be drawn.
 */
export function curvePaths(
  values: readonly number[],
  width: number,
  height: number,
): { pathLine: string; pathArea: string; end: readonly [number, number] } | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const stepX = width / (values.length - 1);
  const y = (v: number): number => (max === 0 ? height : height - (v / max) * (height - 12));
  const points = values.map((v, i) => [Number((i * stepX).toFixed(2)), Number(y(v).toFixed(2))] as const);
  const pathLine = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px},${py}`).join('');
  const last = points[points.length - 1] ?? [0, height];
  const pathArea = `${pathLine}L${last[0]},${height}L0,${height}Z`;
  return { pathLine, pathArea, end: last };
}

export const band = ({ text, receipt: line = null, alarm = false }: { text: string; receipt?: string | null; alarm?: boolean }): string =>
  `<div class="nw-band${alarm ? ' nw-band--alarm' : ''}" role="status">${escapeHtml(text)}${
    line ? `<span class="nw-receipt-line">${escapeHtml(line)}</span>` : ''
  }</div>`;

// ── frame ────────────────────────────────────────────────────────────────────

/**
 * The top bar. `current` names the page; `lampHtml` is the lamp the server
 * filled at request time; the wordmark links to the site root.
 */
export function topBar({
  current,
  lampHtml = null,
  wordmarkHref = SITE_ORIGIN,
}: {
  current: string;
  lampHtml?: string | null;
  wordmarkHref?: string;
}): string {
  const items = NAV.map(
    (item) => `<a href="${escapeHtml(item.href)}"${item.key === current ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`,
  ).join('');
  const currentLabel = NAV.find((i) => i.key === current)?.label ?? 'Home';
  return `<header class="nw-bar" data-bar>
  <div class="nw-frame nw-bar-inner">
    <a class="nw-wordmark" href="${escapeHtml(wordmarkHref)}">${SITE_NAME}</a>
    <nav class="nw-nav nw-label" aria-label="Site" id="nw-nav">${items}</nav>
    <button type="button" class="nw-menu nw-label" aria-expanded="false" aria-controls="nw-nav" data-menu><span>${escapeHtml(currentLabel)}</span><span>Menu</span></button>
    <div class="nw-bar-right">
      ${lampHtml ?? lamp()}
      <div class="nw-bar-controls">
        ${sourcesSwitch()}
        <span class="nw-tag nw-tag--kbd" data-palette-open role="button" tabindex="0">⌘K</span>
      </div>
    </div>
  </div>
  <nav class="nw-nav-row nw-label" aria-label="Site, small screens">${items}</nav>
</header>`;
}

export interface FooterFacts {
  readonly genesisHash: string;
  readonly specVersion: number | string;
  readonly nodeVersion?: string | null;
  /** The render time: the explorer is built at request time. */
  readonly builtAt: string | null;
  /** The best block at render; null before a connection exists. */
  readonly block: number | null;
}

/** The footer. `facts`: {genesisHash, specVersion, nodeVersion, builtAt, block}; every value from the node at render. `extraLine` is the explorer's indexer line (pre-escaped). */
export function footer({ facts, extraLine = null }: { facts: FooterFacts; extraLine?: string | null }): string {
  const link = (label: string, href: string): string => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const short = `${String(facts.genesisHash).slice(0, 6)}…${String(facts.genesisHash).slice(-4)}`;
  return `<footer class="nw-foot" data-footer>
  <div class="nw-frame nw-foot-inner">
    <div class="nw-foot-col"><span class="nw-label">Chain</span>${link('Observatory', `${SITE_ORIGIN}observatory`)}${link('Pulse', `${SITE_ORIGIN}pulse`)}${link('Explorer', EXPLORER_ORIGIN)}${link('Status', `${SITE_ORIGIN}status.json`)}</div>
    <div class="nw-foot-col"><span class="nw-label">Build</span>${link('Docs', DOCS_URL)}${link('SDK', `${DOCS_URL}guide/sdk`)}${link('Faucet', `${SITE_ORIGIN}faucet`)}${link('GitHub', REPO_URL)}</div>
    <div class="nw-foot-col"><span class="nw-label">Govern</span>${link('Constitution', `${REPO_URL}/blob/master/pallets/constitution/src/lib.rs`)}${link('Evidence', `${REPO_URL}/tree/master/evidence`)}${link('Changelog', `${REPO_URL}/releases`)}${link('Disclosures', `${SITE_ORIGIN}posture.json`)}</div>
    <div class="nw-foot-facts"><span>genesis ${escapeHtml(short)}</span><span>spec ${escapeHtml(String(facts.specVersion))} · node ${escapeHtml(facts.nodeVersion ?? '—')}</span><span>site built ${escapeHtml(utc(facts.builtAt) ?? '—')} against block ${facts.block === null ? '—' : escapeHtml(formatInt(facts.block))}</span>${extraLine ? `<span data-indexer-line>${extraLine}</span>` : ''}</div>
    <p class="nw-foot-line">${DISCLAIMER}</p>
    <p class="nw-print-foot" data-print-foot></p>
  </div>
</footer>`;
}

/** The document head. The chrome is linked from `/chrome.css`; fonts preloaded from `/fonts/`; no third party. */
export function head({
  title,
  description,
  cssHref = '/chrome.css',
  extraHead = '',
}: {
  title: string;
  description: string;
  cssHref?: string;
  extraHead?: string;
}): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="dark">
<link rel="preload" href="/fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${escapeHtml(cssHref)}">
${extraHead}`;
}
