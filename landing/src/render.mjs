// Renders the home page (SITE-REDESIGN.md §5.1) from chain facts + content, on
// the plain chrome. Pure: no I/O, no clock, no network. Everything the page
// says is a function of chain-facts.json and src/content.mjs, which is what
// makes the honesty tests meaningful; the one script (src/home/refresh.js)
// only replaces the four "Network right now" values, in place, with newer
// reads of the same figures.
import {
  API_V1,
  RPC_WSS,
  badge,
  button,
  callout,
  card,
  escapeHtml,
  formatUtc,
  kvTable,
  page,
  section,
  stats,
  table,
} from './chrome/templates.mjs';

export { escapeHtml };

const groups = new Intl.NumberFormat('en-US');

/** Every `{{token}}` in a string, filters included. */
export function placeholdersIn(str) {
  return [...String(str).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

/** Plancks → token units, grouped; at most two decimals, truncated (the full figure goes in a title). */
export function formatTokens(plancks, decimals, { places = 2 } = {}) {
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(plancks);
  const whole = groups.format(value / scale);
  const fraction = (value % scale).toString().padStart(Number(decimals), '0').slice(0, places).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Basis points → percent, e.g. 500 → "5 %". Bps are the chain's unit; percent is the reader's. */
function formatPercent(bps) {
  return `${Number((Number(bps) / 100).toFixed(2))} %`;
}

const blockSeconds = (blocks, facts) => (BigInt(blocks) * BigInt(facts.constants.babe.expectedBlockTime)) / 1000n;

const FILTERS = {
  cmn: (value, facts) => formatTokens(value, facts.token.decimals),
  pct: (value) => formatPercent(value),
  percent: (value) => formatPercent(value),
  commas: (value) => groups.format(BigInt(value)),
  /** Blocks → whole days, e.g. 100,800 blocks → "7 days". */
  days: (value, facts) => {
    const days = blockSeconds(value, facts) / 86400n;
    return `${groups.format(days)} day${days === 1n ? '' : 's'}`;
  },
  /** Blocks → whole hours as a number, e.g. 3,600 blocks → "6". */
  hours: (value, facts) => groups.format(blockSeconds(value, facts) / 3600n),
  /** An ISO instant → "23 Oct 2026, 11:32 UTC". */
  utc: (value) => formatUtc(value),
};

/**
 * Resolves `path.to.fact|filter` against the facts object. Returns `undefined`
 * for anything the facts do not contain, which the test suite treats as a
 * failure — an unresolvable placeholder means the page wanted to claim
 * something the chain never told us.
 */
export function resolve(facts, token) {
  const [path, ...filters] = String(token)
    .split('|')
    .map((part) => part.trim());
  let value = path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), facts);
  if (value === undefined || value === null) return undefined;
  for (const name of filters) {
    const filter = FILTERS[name];
    if (!filter) throw new Error(`unknown filter "${name}" in placeholder {{${token}}}`);
    value = filter(value, facts);
  }
  return value;
}

/**
 * Every reader-visible string in the content tree, tagged with where it came
 * from. Identifiers (`key`, `id`, `status`, `chainRefs`, `path`, `name`, `href`)
 * are excluded: they are checked structurally instead.
 */
export function proseOf(content) {
  const skip = new Set(['key', 'id', 'status', 'url', 'href', 'chainRefs', 'path', 'name', 'state']);
  const out = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      out.push([path, node]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (skip.has(key)) continue;
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(content, '');
  return out;
}

/** Fills placeholders and escapes the result — content is data, never markup. */
function fill(str, facts) {
  return escapeHtml(str).replace(/\{\{([^}]+)\}\}/g, (_, token) => {
    const value = resolve(facts, token.trim());
    if (value === undefined) throw new Error(`unresolved placeholder {{${token.trim()}}} — not in chain-facts.json`);
    return escapeHtml(value);
  });
}

/** Fills placeholders without escaping, for template parameters that escape themselves. */
function text(str, facts) {
  return String(str).replace(/\{\{([^}]+)\}\}/g, (_, token) => {
    const value = resolve(facts, token.trim());
    if (value === undefined) throw new Error(`unresolved placeholder {{${token.trim()}}} — not in chain-facts.json`);
    return String(value);
  });
}

// ── the genesis mint: total issuance at block 0 ─────────────────────────────
// chain-facts.json does not carry it yet (state.genesisIssuancePlancks). Until
// it does, the token table names the storage it lives in and the page's script
// reads Balances.TotalIssuance at the genesis block from the public node. The
// storage key is computed here, from the pallet and item names, never typed.
const M64 = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;
const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M64;
const readLE = (bytes, at, n) => bytes.slice(at, at + n).reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n);
/** xxHash64 of a short input (under 32 bytes: the names of a pallet and a storage item). */
export function xxh64(bytes, seed = 0n) {
  if (bytes.length >= 32) throw new Error('xxh64 here handles names under 32 bytes');
  let h = (seed + P5 + BigInt(bytes.length)) & M64;
  let i = 0;
  for (; i + 8 <= bytes.length; i += 8) {
    const k = (rotl((readLE(bytes, i, 8) * P2) & M64, 31) * P1) & M64;
    h = ((rotl(h ^ k, 27) * P1 + P4) & M64);
  }
  if (i + 4 <= bytes.length) {
    h = ((rotl(h ^ ((readLE(bytes, i, 4) * P1) & M64), 23) * P2 + P3) & M64);
    i += 4;
  }
  for (; i < bytes.length; i += 1) h = (rotl(h ^ ((BigInt(bytes[i]) * P5) & M64), 11) * P1) & M64;
  h = ((h ^ (h >> 33n)) * P2) & M64;
  h = ((h ^ (h >> 29n)) * P3) & M64;
  return h ^ (h >> 32n);
}
const le64 = (x) => Array.from({ length: 8 }, (_, i) => Number((x >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
/** Substrate's twox128 of a name, as hex. */
export const twox128 = (name) => {
  const bytes = [...new TextEncoder().encode(name)];
  return le64(xxh64(bytes, 0n)) + le64(xxh64(bytes, 1n));
};
/** The storage key of a plain storage value: twox128(pallet) ‖ twox128(item). */
export const storageKey = (pallet, item) => `0x${twox128(pallet)}${twox128(item)}`;

// ── the sections ─────────────────────────────────────────────────────────────

function hero(c, facts) {
  return `<section class="home-hero" aria-labelledby="hero-h">
  <div class="sc-container">
    <h1 class="sc-display home-headline" id="hero-h">${fill(c.headline, facts)}</h1>
    <p class="sc-lead home-lead">${fill(c.lead, facts)}</p>
    <div class="sc-actions">${button({ text: c.primary.text, href: c.primary.href })}${button({ text: c.secondary.text, href: c.secondary.href, variant: 'secondary' })}</div>
    <p class="sc-caption home-hero-caption">${badge('Testnet')}<span>${fill(c.caption, facts)}</span></p>
  </div>
</section>`;
}

function now(c, facts) {
  const notice = callout({ variant: 'warning', body: '<span data-notice-text></span>' });
  const body = `<div id="network-now" data-api="${escapeHtml(API_V1)}" data-read-at="${escapeHtml(facts.provenance.fetchedAt)}">
  <div class="home-notice" data-notice hidden>${notice}</div>
  ${stats(c.stats.map((s) => ({ key: s.key, label: s.label, value: fill(s.value, facts), caption: s.caption ? fill(s.caption, facts) : null })), { label: c.heading })}
  <div class="home-after">
    <p class="sc-caption"><span data-stale hidden>${badge('Stale')} </span><span data-updated>${fill(c.built, facts)}</span></p>
    ${button({ text: c.action.text, href: c.action.href, variant: 'text' })}
  </div>
</div>`;
  return section({ id: 'now', title: c.heading, intro: fill(c.intro, facts), body });
}

// The diagram: three boxes and two arrows, the same words as the steps. Drawn
// in user units on a 1072 × 72 canvas; colours come from home.css (tokens).
function diagram(steps) {
  const w = 288;
  const gap = (1072 - 3 * w) / 2;
  const boxes = steps
    .map((s, i) => {
      const x = i * (w + gap);
      return `<rect x="${x + 0.5}" y="0.5" width="${w - 1}" height="71" rx="8"></rect><text x="${x + w / 2}" y="41" text-anchor="middle">${escapeHtml(s.title)}</text>`;
    })
    .join('');
  const arrows = [0, 1]
    .map((i) => {
      const x1 = i * (w + gap) + w + 16;
      const x2 = x1 + gap - 32;
      return `<path class="home-arrow" d="M${x1} 36H${x2}M${x2 - 8} 28l8 8-8 8"></path>`;
    })
    .join('');
  return `<figure class="home-diagram"><svg viewBox="0 0 1072 72" role="img" aria-label="${escapeHtml(steps.map((s) => s.title).join(', then '))}">${boxes}${arrows}</svg></figure>`;
}

function how(c, facts) {
  const steps = c.steps
    .map((s) => `<li class="home-step"><h3 class="sc-h3">${fill(s.title, facts)}</h3><p>${fill(s.text, facts)}</p></li>`)
    .join('');
  return section({ id: 'how', title: c.heading, body: `<ol class="sc-cols-3 home-steps">${steps}</ol>${diagram(c.steps)}` });
}

function onChain(c, facts) {
  for (const m of c.modules) {
    for (const ref of m.chainRefs) {
      if (!facts.pallets.some((p) => p.name === ref)) throw new Error(`content cites pallet "${ref}", which the metadata does not list`);
    }
  }
  const rows = c.modules.map((m) => [`<span class="home-module">${escapeHtml(m.name)}</span>`, fill(m.text, facts)]);
  const body = `${table({ columns: c.columns.map((label) => ({ label })), rows, caption: c.heading, className: 'home-modules' })}
  <div class="home-after">${button({ text: c.action.text, href: c.action.href, variant: 'text' })}</div>`;
  return section({ id: 'chain', title: c.heading, intro: fill(c.intro, facts), body });
}

function genesisCell(facts) {
  const plancks = facts.state?.genesisIssuancePlancks;
  const decimals = facts.token.decimals;
  if (plancks) {
    return `<span title="${escapeHtml(`${plancks} plancks`)}">${escapeHtml(formatTokens(plancks, decimals))} ${escapeHtml(facts.token.symbol)}</span>`;
  }
  // Not in the build record: read live at the genesis block (see above).
  return `<span data-genesis data-key="${storageKey('Balances', 'TotalIssuance')}" data-rpc="${escapeHtml(RPC_WSS)}" data-decimals="${escapeHtml(decimals)}" data-symbol="${escapeHtml(facts.token.symbol)}"><span class="sc-skeleton" aria-hidden="true"></span><span class="sc-sr">Loading</span></span>`;
}

function token(c, facts) {
  const rows = c.rows.map((r) => [r.label, r.key === 'genesis' ? genesisCell(facts) : fill(r.value, facts)]);
  const caveats = c.caveats.map((k) => `<p class="sc-body sc-muted" data-caveat="${escapeHtml(k.key)}">${fill(k.text, facts)}</p>`).join('');
  const body = `${kvTable(rows, { caption: c.heading })}
  <div class="home-prose"><p class="sc-body">${fill(c.thesis, facts)}</p>${caveats}</div>`;
  return section({ id: 'token', title: c.heading, body });
}

function status(c, facts) {
  const g = c.gate;
  const gate = `<p class="sc-body" data-caveat="${escapeHtml(g.key)}">${g.sentences.map((s) => fill(s, facts)).join(' ')} ${fill(g.end, facts)} <a href="${escapeHtml(g.link.href)}">${escapeHtml(g.link.text)}</a>.</p>`;
  const body = `${callout({ variant: 'warning', body: fill(c.notice, facts) })}
  <div class="home-prose">${gate}</div>`;
  return section({ id: 'status', title: c.heading, body });
}

function buildOn(c, facts) {
  const cards = c.cards.map((k) => card({ title: k.title, body: fill(k.text, facts), action: k.action })).join('');
  const values = { rpc: RPC_WSS, api: API_V1 };
  const endpoints = c.endpoints
    .map((e) => `<li><span class="sc-caption">${escapeHtml(e.label)}</span><code class="sc-mono">${escapeHtml(values[e.key])}</code></li>`)
    .join('');
  const body = `<div class="sc-cols-3">${cards}</div>
  <ul class="home-endpoints" aria-label="Endpoints">${endpoints}</ul>`;
  return section({ id: 'build', title: c.heading, body });
}

/**
 * The whole page, as a string. Throws rather than emit a page with an
 * unresolved claim. `cssHref` and `scripts` are what the build links.
 */
export function renderPage({ facts, content, builtAt = null, cssHref = '/styles.css', scripts = ['/home.js'] }) {
  const body = [
    hero(content.hero, facts),
    now(content.now, facts),
    how(content.how, facts),
    onChain(content.chain, facts),
    token(content.token, facts),
    status(content.status, facts),
    buildOn(content.build, facts),
  ].join('\n');
  return page({
    title: text(content.meta.title, facts),
    description: text(content.meta.description, facts),
    path: '/',
    current: null,
    facts,
    builtAt: builtAt ?? facts.provenance.fetchedAt,
    body: `<div class="home">\n${body}\n</div>`,
    cssHref,
    scripts,
  });
}
