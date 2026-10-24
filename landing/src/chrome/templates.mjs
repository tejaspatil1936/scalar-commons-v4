// Scalar Commons — the shared chrome as string templates (SITE-REDESIGN.md §3).
// Pure functions: data in, HTML out, no DOM and no clock. The landing pages
// use these directly; explorer/src/chrome-templates.ts mirrors the same
// markup and class names; the docs theme sets VitePress's variables to the
// same tokens. Nothing here types a figure: every count, date or hash is a
// parameter that comes from data.

export const SITE_ORIGIN = 'https://scalarnet.io';
export const EXPLORER_ORIGIN = 'https://explorer.scalarnet.io';
export const REPO = 'https://github.com/tejaspatil1936/scalar-commons-v4';
export const RPC_WSS = 'wss://rpc.scalarnet.io';
export const API_V1 = 'https://api.scalarnet.io/v1';
export const DISCLAIMER = 'Testnet — tokens have no value and the chain may be reset.';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** ` name="value"` pairs; null, undefined and false are left out, true is a bare attribute. */
export const attrs = (map) =>
  Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');

const groups = new Intl.NumberFormat('en-US');
/** 1234567 → "1,234,567" (BigInt-safe). */
export const formatInt = (value) => (value === null || value === undefined || value === '' ? '' : groups.format(BigInt(value)));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An ISO instant → "23 Oct 2026, 11:32 UTC". */
export const formatUtc = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
/** An ISO instant → "23 Oct 2026". */
export const formatDate = (iso) => formatUtc(iso).replace(/, .*$/, '');

/** "0x1234…abcd" / "5FxmB…8GduiA": the first and last characters, the full value goes in a title. */
export const truncateMiddle = (value, head = 6, tail = 4) => {
  const s = String(value ?? '');
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

// ── icons: one set, 20 px, 1.5 px stroke, currentColor ─────────────────────
const ICON_PATHS = {
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
  menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  'external-link': '<path d="M11 4h5v5M16 4l-7 7M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  'chevron-right': '<path d="M8 5l5 5-5 5"/>',
  'chevron-down': '<path d="M5 8l5 5 5-5"/>',
  'arrow-right': '<path d="M4 10h12M11 5l5 5-5 5"/>',
  warning: '<path d="M10 3l8 14H2z"/><path d="M10 8v4M10 14.5v.5"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/>',
};
export const ICONS = Object.keys(ICON_PATHS);
/** An inline icon from the set. Decorative unless given a label. */
export function icon(name, { label = null, className = '' } = {}) {
  const paths = ICON_PATHS[name];
  if (!paths) throw new Error(`no icon "${name}"`);
  const a11y = label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true" focusable="false"';
  return `<svg class="sc-icon sc-icon-${name}${className ? ` ${className}` : ''}" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${a11y}>${paths}</svg>`;
}

// ── links ────────────────────────────────────────────────────────────────────
const isExternal = (href) => /^https?:\/\//.test(href) && !href.startsWith(SITE_ORIGIN);
/** A link; an external one carries the external-link icon and rel="noopener" and opens in the same tab. */
export function link({ href, text, className = '', title = null, download = null }) {
  const ext = isExternal(href);
  return `<a${attrs({ class: className || null, href, rel: ext ? 'noopener' : null, title, download })}>${escapeHtml(text)}${ext ? icon('external-link', { className: 'sc-icon-sm' }) : ''}</a>`;
}

// ── head ─────────────────────────────────────────────────────────────────────
/**
 * The document head: title "Page — Scalar Commons", description, canonical,
 * Open Graph, favicon, the two font preloads and the stylesheet (inlined
 * `css`, or a `cssHref`). `assets` is the URL prefix of the fonts, favicon
 * and og image on this surface.
 */
export function head({ title, description, path = '/', css = null, cssHref = null, scripts = [], assets = '/', origin = SITE_ORIGIN, extraHead = '' }) {
  if (!title || !description) throw new Error('every page needs a title and a description');
  const fullTitle = `${title} — Scalar Commons`;
  const canonical = `${origin}${path}`;
  const style = css ? `<style>${css}</style>` : `<link rel="stylesheet" href="${escapeHtml(cssHref ?? `${assets}styles.css`)}">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Scalar Commons">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(`${SITE_ORIGIN}/og.png`)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${escapeHtml(`${assets}favicon.svg`)}" type="image/svg+xml">
<link rel="preload" href="${escapeHtml(`${assets}fonts/inter-latin-wght-normal.woff2`)}" as="font" type="font/woff2" crossorigin>
${style}
${scripts.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`).join('\n')}${extraHead}
</head>`;
}

// ── header ───────────────────────────────────────────────────────────────────
/** The primary navigation, in order, and nothing else (§4). `site` is '' on scalarnet.io and the origin elsewhere. */
export const navItems = (site = '') => [
  { key: 'network', label: 'Network', href: `${site}/network` },
  { key: 'explorer', label: 'Explorer', href: `${EXPLORER_ORIGIN}/` },
  { key: 'docs', label: 'Docs', href: `${site}/docs/` },
  { key: 'faucet', label: 'Faucet', href: `${site}/faucet` },
];
export const GET_STARTED = '/docs/guide/run-an-agent';

/** Skip link + sticky header: wordmark, nav, GitHub, Get started; a native disclosure menu under 960 px. */
export function header({ current = null, site = '' } = {}) {
  const items = navItems(site);
  const nav = items.map((i) => `<a href="${escapeHtml(i.href)}"${i.key === current ? ' aria-current="page"' : ''}>${escapeHtml(i.label)}</a>`).join('');
  const menuLinks = [...items, { key: 'github', label: 'GitHub', href: REPO }]
    .map((i) => `<a href="${escapeHtml(i.href)}"${i.key === current ? ' aria-current="page"' : ''}${i.key === 'github' ? ' rel="noopener"' : ''}>${escapeHtml(i.label)}${i.key === 'github' ? icon('external-link', { className: 'sc-icon-sm' }) : ''}</a>`)
    .join('');
  return `<a class="sc-skip" href="#main">Skip to content</a>
<header class="sc-header">
  <div class="sc-container sc-header-inner">
    <a class="sc-wordmark" href="${escapeHtml(`${site}/`)}">Scalar Commons</a>
    <nav class="sc-nav" aria-label="Primary">${nav}</nav>
    <div class="sc-header-end">
      <a class="sc-header-link" href="${REPO}" rel="noopener">GitHub${icon('external-link', { className: 'sc-icon-sm' })}</a>
      <a class="sc-btn sc-btn-primary" href="${escapeHtml(`${site}${GET_STARTED}`)}">Get started</a>
      <details class="sc-menu">
        <summary aria-label="Menu">${icon('menu')}${icon('close')}<span>Menu</span></summary>
        <nav class="sc-menu-panel" aria-label="Menu">${menuLinks}</nav>
      </details>
    </div>
  </div>
</header>`;
}

// ── footer ───────────────────────────────────────────────────────────────────
/** The four link columns and the one caption line; every figure in it comes from chain-facts.json. */
export function footer({ facts, builtAt, site = '' }) {
  const p = facts?.provenance ?? {};
  const col = (title, items) =>
    `<div class="sc-footer-col"><h2>${escapeHtml(title)}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
  const a = (text, href, extra = {}) => link({ text, href, ...extra });
  const value = (label, v) => `<li class="sc-footer-value"><span>${escapeHtml(label)}</span><code>${escapeHtml(v)}</code></li>`;
  const line = `${DISCLAIMER} Runtime ${p.specName ?? ''} ${p.specVersion ?? ''}. Page built ${formatUtc(builtAt)} from block ${formatInt(p.readAtBlock)}.`;
  return `<footer class="sc-footer">
  <div class="sc-container">
    <div class="sc-footer-cols">
      ${col('Product', [a('Home', `${site}/`), a('Network', `${site}/network`), a('Explorer', `${EXPLORER_ORIGIN}/`), a('Faucet', `${site}/faucet`)])}
      ${col('Developers', [a('Docs', `${site}/docs/`), a('Run a node', `${site}/docs/guide/run-a-node`), a('Run an agent', `${site}/docs/guide/run-an-agent`), a('Run a validator', `${site}/docs/guide/run-a-validator`), a('SDK', `${site}/docs/guide/sdk`), a('Privacy demo', `${site}/oversight`)])}
      ${col('Project', [a('GitHub', REPO), a('Releases', `${REPO}/releases`), a('Constitution', `${site}/docs/reference/constitution`), a('Security', `${REPO}/blob/master/SECURITY.md`)])}
      <div class="sc-footer-col"><h2>Network</h2><ul>${value('Public RPC', RPC_WSS)}${value('REST API', API_V1)}<li>${a('Chain spec (download)', `${site}/docs/chainspec.json`, { download: 'chainspec.json' })}</li></ul></div>
    </div>
    <p class="sc-footer-line">${escapeHtml(line)}</p>
  </div>
</footer>`;
}

// ── components ───────────────────────────────────────────────────────────────
/** Button: primary, secondary or text (text carries arrow-right). As a link when given href. */
export function button({ text, href = null, variant = 'primary', type = 'button', disabled = false, attrsExtra = {} }) {
  const cls = `sc-btn sc-btn-${variant}`;
  const arrow = variant === 'text' ? icon('arrow-right', { className: 'sc-icon-sm' }) : '';
  if (href) {
    const ext = isExternal(href);
    return `<a${attrs({ class: cls, href, rel: ext ? 'noopener' : null, 'aria-disabled': disabled ? 'true' : null, ...attrsExtra })}>${escapeHtml(text)}${arrow}</a>`;
  }
  return `<button${attrs({ class: cls, type, disabled, ...attrsExtra })}>${escapeHtml(text)}${arrow}</button>`;
}

/** Card: title, body, optional text button. */
export function card({ title, body, action = null }) {
  return `<article class="sc-card"><h3>${escapeHtml(title)}</h3><p>${body}</p>${action ? `<div>${button({ ...action, variant: 'text' })}</div>` : '<div></div>'}</article>`;
}

/** A stat: label, value (HTML), optional caption; `key` names it for the live refresh. */
export const stat = ({ label, value, caption = null, key = null }) =>
  `<div class="sc-stat"${key ? ` data-stat="${escapeHtml(key)}"` : ''}><span class="sc-stat-label">${escapeHtml(label)}</span><span class="sc-stat-value"${key ? ' data-value' : ''}>${value ?? skeleton()}</span>${caption !== null ? `<span class="sc-stat-caption"${key ? ' data-caption' : ''}>${caption}</span>` : ''}</div>`;
/** Stats in a 4-column grid (2 on mobile) with hairlines between cells. */
export const stats = (items, { id = null, label = null } = {}) =>
  `<div class="sc-stats"${attrs({ id, role: label ? 'group' : null, 'aria-label': label })}>${items.map(stat).join('')}</div>`;

/** A table. `columns`: [{ label, align }]; `rows`: arrays of cell HTML; `empty`: the sentence when there are none. */
export function table({ columns, rows, empty = 'Nothing to show.', caption = null, id = null, className = '' }) {
  const th = columns.map((c) => `<th scope="col"${c.align === 'right' ? ' class="sc-r"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((cell, i) => `<td${columns[i]?.align === 'right' ? ' class="sc-r"' : ''}>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="sc-empty-cell" colspan="${columns.length}">${escapeHtml(empty)}</td></tr>`;
  return `<div class="sc-table-wrap"${id ? ` id="${escapeHtml(id)}"` : ''}><table class="sc-table${className ? ` ${className}` : ''}">${caption ? `<caption class="sc-sr">${escapeHtml(caption)}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** A key/value table: rows of [label, value HTML]. */
export function kvTable(rows, { caption = null } = {}) {
  return `<div class="sc-table-wrap"><table class="sc-table sc-kv">${caption ? `<caption class="sc-sr">${escapeHtml(caption)}</caption>` : ''}<tbody>${rows.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
}

/** The status words a badge may carry, and their tone. */
export const BADGES = { Live: 'ok', Finalized: 'ok', Active: 'ok', Succeeded: 'ok', Pending: 'warn', Stale: 'warn', Testnet: 'warn', Queued: 'warn', Dispute: 'bad', Slashed: 'bad', Failed: 'bad', 'Operator-run': 'neutral' };
export function badge(word) {
  const tone = BADGES[word];
  if (!tone) throw new Error(`"${word}" is not a status word`);
  return `<span class="sc-badge${tone === 'neutral' ? '' : ` sc-badge-${tone}`}">${escapeHtml(word)}</span>`;
}

/** Tabs whose active tab is in the URL. items: [{ label, href, current }] */
export function tabs(items, { label = 'Sections' } = {}) {
  return `<div class="sc-tabs" role="tablist" aria-label="${escapeHtml(label)}">${items.map((t) => `<a role="tab" href="${escapeHtml(t.href)}" aria-selected="${t.current ? 'true' : 'false'}">${escapeHtml(t.label)}</a>`).join('')}</div>`;
}

/** Filter chips as links (each a URL) or buttons (data-filter). */
export function chips(items, { label = 'Filter' } = {}) {
  return `<div class="sc-chips" role="group" aria-label="${escapeHtml(label)}">${items
    .map((c) => (c.href ? `<a class="sc-chip" href="${escapeHtml(c.href)}"${c.current ? ' aria-current="page"' : ''}>${escapeHtml(c.label)}</a>` : `<button type="button" class="sc-chip" data-filter="${escapeHtml(c.value)}" aria-pressed="${c.current ? 'true' : 'false'}">${escapeHtml(c.label)}</button>`))
    .join('')}</div>`;
}

/** The search field (44 px, icon, placeholder), in a GET form. */
export function searchField({ action, name = 'q', placeholder, label, value = '', button: withButton = true }) {
  return `<form class="sc-search-row" role="search" action="${escapeHtml(action)}" method="get"><label class="sc-search"><span class="sc-sr">${escapeHtml(label)}</span>${icon('search')}<input class="sc-input" type="search" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false"></label>${withButton ? '<button class="sc-btn sc-btn-secondary" type="submit">Search</button>' : ''}</form>`;
}

/** A copy button for a value. */
export const copyButton = (value, label = 'Copy') =>
  `<button type="button" class="sc-copy" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(`${label} ${value}`)}">${icon('copy', { className: 'sc-icon-sm' })}<span>Copy</span></button>`;

/** Code block: bg-2, mono, a copy button top-right, no syntax colours. */
export const codeBlock = (code, { label = 'Copy code' } = {}) =>
  `<div class="sc-code"><pre><code>${escapeHtml(code)}</code></pre>${copyButton(code, label)}</div>`;

/** Callout: info, warning, error (or ok for a success message). */
export function callout({ variant = 'info', title = null, body }) {
  const ico = { info: 'info', warning: 'warning', error: 'warning', ok: 'check' }[variant];
  return `<div class="sc-callout sc-callout-${variant}" role="${variant === 'error' || variant === 'warning' ? 'alert' : 'note'}">${icon(ico)}<div class="sc-callout-body">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}<div>${body}</div></div></div>`;
}

/** Pagination: Previous / Next and "Showing a–b of n". */
export function pagination({ prevHref = null, nextHref = null, from, to, total }) {
  const b = (text, href) => (href ? button({ text, href, variant: 'secondary' }) : `<span class="sc-btn sc-btn-secondary" aria-disabled="true">${escapeHtml(text)}</span>`);
  return `<nav class="sc-pagination" aria-label="Pagination">${b('Previous', prevHref)}${b('Next', nextHref)}<span class="sc-caption">Showing ${formatInt(from)}–${formatInt(to)}${total !== null && total !== undefined ? ` of ${formatInt(total)}` : ''}</span></nav>`;
}

/** Empty state: one sentence in text-2. */
export const emptyState = (sentence) => `<p class="sc-empty">${escapeHtml(sentence)}</p>`;
/** Loading: a neutral skeleton bar the size of the value it replaces. */
export const skeleton = (width = '6ch') => `<span class="sc-skeleton" style="width:${escapeHtml(width)}" aria-hidden="true"></span><span class="sc-sr">Loading</span>`;

/** An address or hash: mono, truncated, full value in title, a copy button, linked when href is given. */
export function address(value, { href = null, head = 6, tail = 4 } = {}) {
  if (!value) return '';
  const short = escapeHtml(truncateMiddle(value, head, tail));
  const text = href ? `<a href="${escapeHtml(href)}" title="${escapeHtml(value)}">${short}</a>` : `<span title="${escapeHtml(value)}">${short}</span>`;
  return `<span class="sc-addr">${text}${copyButton(value)}</span>`;
}

/** Breadcrumb: [{ text, href }], the last is the current page. */
export function breadcrumb(items) {
  return `<nav class="sc-crumbs" aria-label="Breadcrumb">${items
    .map((c, i) => (i === items.length - 1 ? `<span aria-current="page">${escapeHtml(c.text)}</span>` : `<a href="${escapeHtml(c.href)}">${escapeHtml(c.text)}</a>${icon('chevron-right', { className: 'sc-icon-sm' })}`))
    .join('')}</nav>`;
}

/** A section with an h2 and an optional intro sentence. */
export const section = ({ id = null, title, intro = null, body }) =>
  `<section class="sc-section"${id ? ` id="${escapeHtml(id)}"` : ''}${id ? ` aria-labelledby="${escapeHtml(id)}-h"` : ''}><div class="sc-container"><div class="sc-section-head"><h2 class="sc-h2"${id ? ` id="${escapeHtml(id)}-h"` : ''}>${escapeHtml(title)}</h2>${intro ? `<p>${intro}</p>` : ''}</div>${body}</div></section>`;

/** A whole page: head, header, <main id="main">, footer. */
export function page({ title, description, path, current = null, facts, builtAt, body, css = null, cssHref = null, scripts = [], assets = '/', site = '', origin = SITE_ORIGIN, extraHead = '' }) {
  return `${head({ title, description, path, css, cssHref, scripts, assets, origin, extraHead })}
<body>
${header({ current, site })}
<main id="main">
${body}
</main>
${footer({ facts, builtAt, site })}
</body>
</html>
`;
}
