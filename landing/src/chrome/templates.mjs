// Nightwatch — the templates. Plain functions returning strings, like
// render.mjs: no DOM, no clock, no network, so a page is a pure function of
// its facts. Every figure on a page is a Reading, and a Reading without a
// `source` throws here, at render time, so the build fails rather than ship a
// figure that names no origin. Words that appear on a page come from the
// caller (the brief's copy in content.mjs, or the chain); this module adds
// only the labels the brief fixes (LIVE, SETTLED, "Sources", "Menu", …).
import { attrs, escapeHtml } from './html.mjs';

export { escapeHtml };

export const SITE_NAME = 'Scalar Commons';
export const DISCLAIMER = 'Testnet — the token has no value and the chain may be reset.';
export const EXPLORER_ORIGIN = 'https://explorer.scalarnet.io';
export const DOCS_URL = 'https://scalarnet.io/docs/';
export const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4';
export const API_HOST = 'api.scalarnet.io';
export const RPC_WSS = 'wss://rpc.scalarnet.io';

/** The site nav, in the brief's order. `href` is relative to the site root; consumers under another root pass `base`. */
export const NAV = [
  { key: 'observatory', label: 'Observatory', href: 'observatory' },
  { key: 'pulse', label: 'Pulse', href: 'pulse' },
  { key: 'explorer', label: 'Explorer', href: EXPLORER_ORIGIN },
  { key: 'docs', label: 'Docs', href: DOCS_URL },
  { key: 'oversight', label: 'Oversight', href: 'oversight' },
  { key: 'faucet', label: 'Faucet', href: 'faucet' },
];

const isAbsolute = (href) => /^(?:[a-z]+:)?\/\//i.test(href);
const withBase = (href, base) => (isAbsolute(href) || !base ? href : `${base}${href}`);

/** The states a stub, a tag or a reading can be in, each with the word the brief pairs it with. */
export const STATE_WORDS = {
  live: 'LIVE',
  record: 'RECORD',
  sealed: 'SEALED',
  connecting: 'CONNECTING',
  dispute: 'IN DISPUTE',
  slashed: 'SLASHED',
  operator: 'OPERATOR-RUN',
  built: 'AS BUILT',
};

// ── atoms ────────────────────────────────────────────────────────────────────

export function leader({ arrow = false } = {}) {
  return `<span class="nw-leader${arrow ? ' nw-leader--arrow' : ''}" aria-hidden="true"></span>`;
}

/** `GET api.scalarnet.io/v1/status` style request line for a source. */
export function requestLine(source) {
  const url = String(source.url).replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
  // A file or a build step is named by itself; a request by its verb.
  return source.method === 'FILE' || source.method === 'BUILD' ? url : `${source.method} ${url}`;
}

/** UTC to the second, the way every receipt prints time. */
export const utc = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/Z$/, ' UTC') : null);
/** The UTC day alone, for the bar's AS BUILT tag; the full time is in the footer. */
export const utcDay = (iso) => (iso ? utc(iso).slice(0, 10) : null);

/**
 * The receipt under a figure: the request, when and at which block it was
 * fetched, the raw bytes, and the computation when the figure is derived.
 * A null `fetchedAt`/`block` prints a dash: the live page fills it.
 */
export function receipt(source) {
  const fetched = source.fetchedAt ? utc(source.fetchedAt) : '—';
  const block = source.block === null || source.block === undefined ? '—' : `block ${formatInt(source.block)}`;
  const raw = source.raw ? `<a href="${escapeHtml(source.raw)}" data-raw>raw ↗</a>` : '<span data-raw>raw —</span>';
  const computed = source.computed ? `<div data-computed>${escapeHtml(source.computed)}</div>` : '';
  return `<div class="nw-receipt" data-receipt><div data-request>${escapeHtml(requestLine(source))}</div><div data-fetched>fetched ${escapeHtml(fetched)} · ${escapeHtml(block)}</div><div>${raw}</div>${computed}</div>`;
}

export function receiptLine(source) {
  const fetched = source.fetchedAt ? utc(source.fetchedAt) : '—';
  const block = source.block === null || source.block === undefined ? '' : ` · block ${formatInt(source.block)}`;
  return `<span class="nw-receipt-line" data-receipt-line>${escapeHtml(requestLine(source))}${escapeHtml(block)} · ${escapeHtml(fetched)}</span>`;
}

export function stub({ state = 'record', sealed = false, label = null } = {}) {
  const word = STATE_WORDS[state] ?? state;
  const tag = sealed ? 'span' : 'button';
  return `<${tag} class="nw-stub"${attrs({ type: sealed ? null : 'button', 'data-state': state, 'data-sealed': sealed ? 'true' : null, 'aria-label': label ?? `${word} · show the source`, 'aria-expanded': sealed ? null : 'false' })}></${tag}>`;
}

const groups = new Intl.NumberFormat('en-US');
export const formatInt = (n) => groups.format(typeof n === 'bigint' ? n : Number(n));

/**
 * The Reading. `figure` is a string already formatted (or null while a live
 * page has not read it yet), `size` one of xl | l | m | body, `state` the
 * stub's state, `source` the origin — required. `sub` is the optional
 * sub-line (e.g. `n operator-run`), `href` wraps the figure in a link, and
 * `live` marks the slot for the client to fill (`data-reading=key`).
 */
export function reading({ key, label, figure = null, size = 'm', state = 'record', sealed = false, source, sub = null, href = null, live = false, className = '', unit = null, stack = false, id = null }) {
  if (!source || !source.method || !source.url) {
    throw new Error(`Reading "${label ?? key}" has no source: every figure names its origin {method, url, fetchedAt, block, raw}`);
  }
  const loading = live && figure === null;
  const classes = ['nw-reading', stack ? 'nw-reading--stack' : '', loading ? 'is-loading' : '', className].filter(Boolean).join(' ');
  const figureText = figure === null ? '' : escapeHtml(figure);
  const unitHtml = unit ? `<span class="nw-unit">${escapeHtml(unit)}</span>` : '';
  const figureInner = `<span class="nw-figure nw-figure--${escapeHtml(size)}" data-reading-value${live ? ' aria-live="polite" aria-atomic="true"' : ''}>${figureText}${unitHtml}</span>`;
  const figureHtml = href ? `<a href="${escapeHtml(href)}">${figureInner}</a>` : figureInner;
  return `<div class="${classes}"${attrs({ 'data-reading': key, 'data-sealed': sealed ? 'true' : null, id })}>
  <div class="nw-reading-line"><span class="nw-label">${escapeHtml(label)}</span>${leader()}<span class="nw-reading-figure">${figureHtml}${stub({ state, sealed })}</span></div>
  ${sub ? `<p class="nw-reading-sub" data-reading-sub>${escapeHtml(sub)}</p>` : ''}${receiptLine(source)}
  ${receipt(source)}
</div>`;
}

export function tag({ state = 'record', text, detail = null }) {
  const dot = state === 'kbd' ? '' : '<span class="nw-dot" aria-hidden="true"></span>';
  // The detail (a time, a block) is the part a narrow bar may hide; the word stays.
  const tail = detail === null ? '' : `<span class="nw-tag-detail"> · ${escapeHtml(detail)}</span>`;
  return `<span class="nw-tag" data-state="${escapeHtml(state)}">${dot}${escapeHtml(text)}${tail}</span>`;
}

/** The lamp, unlit and connecting until the socket opens. The text is the client's to set. */
export function lamp({ rpc = RPC_WSS } = {}) {
  return `<span class="nw-lamp" data-lamp data-state="connecting" data-lit="false" role="status" aria-live="off"><span class="nw-lamp-dot" aria-hidden="true"></span><span class="nw-lamp-text nw-label">connecting · ${escapeHtml(rpc)}</span></span>`;
}

export function sourcesSwitch() {
  return `<button type="button" class="nw-sources nw-label" role="switch" aria-checked="false" data-sources-switch><span class="nw-sources-word">Sources</span><span class="nw-switch" aria-hidden="true"></span></button>`;
}

export function button({ text, type = 'button', className = '', disabled = false, name = null }) {
  return `<button class="nw-button ${className}"${attrs({ type, disabled, name })}>${escapeHtml(text)}<span class="nw-dots" aria-hidden="true" hidden><span></span><span></span><span></span></span></button>`;
}
export const quiet = ({ text, href = null, className = '', attrsExtra = {} }) =>
  href ? `<a class="nw-quiet ${className}" href="${escapeHtml(href)}"${attrs(attrsExtra)}>${escapeHtml(text)}</a>` : `<button type="button" class="nw-quiet ${className}"${attrs(attrsExtra)}>${escapeHtml(text)}</button>`;
export function field({ name, label, placeholder = '', value = '', type = 'text', autocomplete = 'off' }) {
  return `<label class="nw-label" for="field-${escapeHtml(name)}">${escapeHtml(label)}</label><input class="nw-field"${attrs({ id: `field-${name}`, name, type, placeholder, value, autocomplete, spellcheck: 'false' })}><span class="nw-field-error" data-field-error hidden></span>`;
}
export const filter = (items) => `<nav class="nw-filter nw-label">${items.map((i) => `<a href="${escapeHtml(i.href)}"${i.current ? ' aria-current="true"' : ''}>${escapeHtml(i.label)}</a>`).join('')}</nav>`;
export const segments = (items) => `<div class="nw-segments nw-label" role="group">${items.map((i) => `<button type="button"${attrs({ 'aria-pressed': i.current ? 'true' : 'false', 'data-value': i.value })}>${escapeHtml(i.label)}</button>`).join('')}</div>`;
export const pager = ({ from, to, total, nextHref = null, prevHref = null }) =>
  `<nav class="nw-pager nw-label" aria-label="Pages">${prevHref ? `<a href="${escapeHtml(prevHref)}">← previous</a>` : ''}<span>${formatInt(from)}–${formatInt(to)} of ${formatInt(total)}</span>${nextHref ? `<a href="${escapeHtml(nextHref)}">next →</a>` : ''}</nav>`;
export const copy = (value, label = 'Copy') => `<button type="button" class="nw-copy nw-label" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}">Copy</button>`;

// ── compounds ────────────────────────────────────────────────────────────────

export function code({ text, copyable = true, lang = null }) {
  return `<figure class="nw-code nw-copyable"${attrs({ 'data-lang': lang })}><pre><code>${escapeHtml(text)}</code></pre>${copyable ? copy(text, 'Copy this block') : ''}</figure>`;
}
export const raw = (json) => `<pre class="nw-raw">${escapeHtml(typeof json === 'string' ? json : JSON.stringify(json, null, 1))}</pre>`;
export function address(full, { href = null } = {}) {
  const short = `${full.slice(0, 6)}…${full.slice(-4)}`;
  const inner = `<span class="nw-address-full nw-mono">${escapeHtml(full)}${copy(full, 'Copy address')}</span>`;
  return href ? `<a class="nw-address" href="${escapeHtml(href)}">${escapeHtml(short)}${inner}</a>` : `<span class="nw-address">${escapeHtml(short)}${inner}</span>`;
}
export function agentName({ name, href = null, operator = false, dispute = false }) {
  const classes = ['nw-agent', operator ? 'is-operator' : '', dispute ? 'is-dispute' : ''].filter(Boolean).join(' ');
  return href ? `<a class="${classes}" href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : `<span class="${classes}">${escapeHtml(name)}</span>`;
}

/** `rows`: [{cells: [index, hash, call, signer, state], href?, selected?}]; `head`: column words. */
export function ledger({ rows, head = null, sheet = false, className = '' }) {
  const headHtml = head ? `<li class="nw-ledger-row nw-ledger-head nw-label" role="row">${head.map((h) => `<span>${escapeHtml(h)}</span>`).join('')}</li>` : '';
  const body = rows
    .map((row) => `<li class="nw-ledger-row"${attrs({ 'aria-selected': row.selected ? 'true' : null, 'data-id': row.id })}>${row.cells.map((c, i) => `<span class="${['nw-ledger-index nw-label', 'nw-mono', 'nw-ledger-call', 'nw-ledger-signer nw-mono', ''][i] ?? ''}">${c}</span>`).join('')}</li>`)
    .join('\n');
  return `<ol class="nw-ledger${sheet ? ' nw-ledger--sheet' : ''} ${className}" role="table">${headHtml}${body}</ol>`;
}

/** `entries`: [{time, text, state: 'newest'|'final'|'dispute'|'slash'|null, href?}] newest first. */
export function rail({ entries, className = '' }) {
  return `<ol class="nw-rail ${className}">${entries
    .map((e) => `<li class="nw-rail-entry"><span class="nw-rail-tick${e.state ? ` is-${escapeHtml(e.state)}` : ''}" aria-hidden="true"></span><span class="nw-rail-time nw-label">${escapeHtml(e.time)}</span><div>${e.html ?? escapeHtml(e.text ?? '')}</div></li>`)
    .join('')}</ol>`;
}

/**
 * The Day Bar: the last three settled eras and the current one. `segments`:
 * four of {era, label, fill (0..1), current}. `valueNow`/`valueMax` in blocks.
 */
export function dayBar({ segments: segs, valueNow = 0, valueMax = 3600, ariaLabel }) {
  return `<div class="nw-daybar" data-daybar role="progressbar" aria-valuemin="0"${attrs({ 'aria-valuenow': valueNow, 'aria-valuemax': valueMax, 'aria-label': ariaLabel })}>
  <div class="nw-daybar-track">${segs.map((s) => `<div class="nw-daybar-seg${s.current ? ' is-current' : ''}"${attrs({ 'data-era': s.era })}><div class="nw-daybar-fill" style="width:${Math.max(0, Math.min(100, Math.round((s.fill ?? 0) * 100)))}%"></div></div>`).join('')}</div>
  <div class="nw-daybar-labels">${segs.map((s) => `<span class="nw-label" data-daybar-label>${escapeHtml(s.label ?? '')}</span>`).join('')}</div>
</div>`;
}

/** The Spine: `ticks` newest first, each {number, final, newest, label}. `form`: margin | explorer | comb. */
export function spine({ ticks, form = 'margin', ariaLabel }) {
  return `<ol class="nw-spine nw-spine--${escapeHtml(form)}" data-spine role="img"${attrs({ 'aria-label': ariaLabel })}>${ticks
    .map((t) => `<li class="nw-spine-tick${t.final ? ' is-final' : ''}${t.newest ? ' is-newest' : ''}"${attrs({ 'data-block': t.number })}>${t.label ? `<span class="nw-spine-number nw-label">${escapeHtml(t.label)}</span>` : ''}${t.html ?? ''}</li>`)
    .join('')}</ol>`;
}

/**
 * The Curve, as an SVG string built from `points` ([x, y] in data space) by a
 * caller that already ran d3-shape (curve.mjs does). `pathLine`/`pathArea`
 * are the computed `d` strings; `labels` three values for the left edge;
 * `ticks` baseline event ticks [{x, state}]; `table` rows for the fallback.
 */
export function curve({ id, width = 400, height = 120, pathLine, pathArea, labels = [], end = null, ticks = [], alt, table = null }) {
  const labelHtml = labels.map((l, i) => `<text class="nw-curve-value" x="0" y="${12 + i * ((height - 12) / Math.max(1, labels.length - 1))}">${escapeHtml(l)}</text>`).join('');
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
  const tableHtml = table ? `<table><tbody>${table.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
  return `<figure class="nw-curve" data-curve="${escapeHtml(id)}"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(alt)}"><path class="nw-curve-pool" d="${pathArea}"></path><path class="nw-curve-line" d="${pathLine}"></path>${labelHtml}${tickHtml}${endHtml}</svg>${tableHtml}</figure>`;
}

export function redaction({ state = 'sealed', text = 'no key held', hashBits = null }) {
  if (state === 'hash' && hashBits) {
    return `<span class="nw-redaction nw-redaction--hash" role="img" aria-label="hash only">${hashBits.map((b) => `<span${b ? ' class="is-on"' : ''}></span>`).join('')}</span>`;
  }
  return `<span class="nw-redaction${state === 'lifted' ? ' is-lifted' : ''}" data-redaction="${escapeHtml(state)}">${state === 'sealed' ? escapeHtml(text) : ''}</span>`;
}

export const band = ({ text, receipt: line = null, alarm = false }) =>
  `<div class="nw-band${alarm ? ' nw-band--alarm' : ''}" role="status">${escapeHtml(text)}${line ? `<span class="nw-receipt-line">${escapeHtml(line)}</span>` : ''}</div>`;
export const marginNote = ({ label, text }) => `<aside class="nw-note">${leader()}<div class="nw-note-body"><span class="nw-label">${escapeHtml(label)}</span>${escapeHtml(text)}</div></aside>`;
export const sheet = ({ id, html }) => `<div class="nw-sheet" id="${escapeHtml(id)}"><span class="nw-sheet-handle" aria-hidden="true"></span>${html}</div>`;

export function palette() {
  return `<div class="nw-palette" data-palette role="dialog" aria-modal="true" aria-label="Search">
  <div class="nw-palette-sheet">
    <input class="nw-field" type="search" placeholder="agents · accounts · blocks · docs · commands" aria-label="Search" data-palette-input autocomplete="off" spellcheck="false">
    <div class="nw-palette-results" data-palette-results role="listbox"></div>
    <p class="nw-palette-keys nw-label">↑↓ move · ↵ open · ⇥ section · esc close</p>
  </div>
</div>`;
}

// ── frame ────────────────────────────────────────────────────────────────────

/**
 * The top bar. `current` names the page; `base` prefixes relative hrefs for
 * consumers served under another root; `present` adds the Observatory's
 * Present button; `lampHtml` lets a server-rendered consumer pass a filled lamp.
 */
export function topBar({ current, base = '', present = false, lampHtml = null, wordmarkHref = null }) {
  const items = NAV.map((item) => `<a href="${escapeHtml(withBase(item.href, base))}"${item.key === current ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`).join('');
  const currentLabel = NAV.find((i) => i.key === current)?.label ?? 'Home';
  return `<header class="nw-bar" data-bar>
  <div class="nw-frame nw-bar-inner">
    <a class="nw-wordmark" href="${escapeHtml(wordmarkHref ?? withBase('./', base))}">${SITE_NAME}</a>
    <nav class="nw-nav nw-label" aria-label="Site" id="nw-nav">${items}</nav>
    <button type="button" class="nw-menu nw-label" aria-expanded="false" aria-controls="nw-nav" data-menu><span>${escapeHtml(currentLabel)}</span><span>Menu</span></button>
    <div class="nw-bar-right">
      ${lampHtml ?? lamp()}
      <div class="nw-bar-controls">
        ${sourcesSwitch()}
        <span class="nw-tag nw-tag--kbd" data-palette-open role="button" tabindex="0">⌘K</span>
        ${present ? '<button type="button" class="nw-quiet nw-present" aria-pressed="false" aria-keyshortcuts="P">Present</button>' : ''}
      </div>
    </div>
  </div>
  <nav class="nw-nav-row nw-label" aria-label="Site, small screens">${items}</nav>
</header>`;
}

/** The footer. `facts`: {genesisHash, specVersion, nodeVersion, builtAt, block}; every value from a record. */
export function footer({ facts, base = '' }) {
  const link = (label, href) => `<a href="${escapeHtml(withBase(href, base))}">${escapeHtml(label)}</a>`;
  const short = `${String(facts.genesisHash).slice(0, 6)}…${String(facts.genesisHash).slice(-4)}`;
  return `<footer class="nw-foot" data-footer>
  <div class="nw-frame nw-foot-inner">
    <div class="nw-foot-col"><span class="nw-label">Chain</span>${link('Observatory', 'observatory')}${link('Pulse', 'pulse')}${link('Explorer', EXPLORER_ORIGIN)}${link('Status', 'status.json')}</div>
    <div class="nw-foot-col"><span class="nw-label">Build</span>${link('Docs', DOCS_URL)}${link('SDK', `${DOCS_URL}guide/sdk`)}${link('Faucet', 'faucet')}${link('GitHub', REPO_URL)}</div>
    <div class="nw-foot-col"><span class="nw-label">Govern</span>${link('Constitution', `${REPO_URL}/blob/master/pallets/constitution/src/lib.rs`)}${link('Evidence', `${REPO_URL}/tree/master/evidence`)}${link('Changelog', `${REPO_URL}/releases`)}${link('Disclosures', 'posture.json')}</div>
    <div class="nw-foot-facts"><span>genesis ${escapeHtml(short)}</span><span>spec ${escapeHtml(facts.specVersion)} · node ${escapeHtml(facts.nodeVersion ?? '—')}</span><span>site built ${escapeHtml(utc(facts.builtAt) ?? '—')} against block ${escapeHtml(formatInt(facts.block))}</span></div>
    <p class="nw-foot-line">${DISCLAIMER}</p>
    <p class="nw-print-foot" data-print-foot></p>
  </div>
</footer>`;
}

/** The document head. The chrome is inlined for first paint; fonts preloaded; no third party. */
export function head({ title, description, css, scripts = [], boot = true, extraHead = '' }) {
  const sourcesBoot = boot ? '<script>try{if(localStorage.getItem("observatory:sources")==="1")document.documentElement.setAttribute("data-sources","")}catch(e){}</script>' : '';
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="dark">
${sourcesBoot}
<link rel="preload" href="fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>${String(css).replace(/<\/style/gi, '<\\/style')}</style>
${extraHead}${scripts.map((s) => `<script type="module" src="${escapeHtml(s)}"></script>`).join('\n')}`;
}
