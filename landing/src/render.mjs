// Renders the home page from chain facts + content (SITE-REDESIGN.md §5.1).
// Pure: no clock, no network — everything the page says is a function of
// chain-facts.json and src/content.mjs, which is what makes the honesty tests
// meaningful. The layout is the shared chrome (src/chrome/templates.mjs);
// every figure is a `{{placeholder}}` resolved here, and an unresolvable one
// throws, so the build fails rather than ship a number no node reported.
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
import { homeCss } from './home/assets.mjs';

export { escapeHtml };

const groups = new Intl.NumberFormat('en-US');

/** Every `{{token}}` in a string, filters included. */
export function placeholdersIn(str) {
  return [...String(str).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

/** Plancks → token units, grouped, exact: the fraction is kept only where it is non-zero. */
function formatTokens(plancks, decimals) {
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(plancks);
  const whole = groups.format(value / scale);
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Basis points → percent with a space before the sign (§6): 500 → "5 %", 25 → "0.25 %". */
function formatPercent(bps) {
  return `${Number((Number(bps) / 100).toFixed(4))} %`;
}

const blockSeconds = (blocks, facts) => (BigInt(blocks) * BigInt(facts.constants.babe.expectedBlockTime)) / 1000n;

/** Blocks → a duration in the largest whole unit, from the chain's own expected block time. */
function formatBlocks(blocks, facts) {
  const seconds = blockSeconds(blocks, facts);
  for (const [name, size] of [['day', 86400n], ['hour', 3600n], ['minute', 60n], ['second', 1n]]) {
    if (seconds >= size) {
      const whole = seconds / size;
      const label = `${groups.format(whole)} ${name}${whole === 1n ? '' : 's'}`;
      return seconds % size === 0n ? label : `over ${label}`;
    }
  }
  return `${groups.format(seconds)} seconds`;
}

const FILTERS = {
  /** Plancks → CMN, exact ("1,000", "0.02"). */
  cmn: (value, facts) => formatTokens(value, facts.token.decimals),
  /** Whole CMN in thousands, millions or billions ("100 B") when it divides evenly. */
  cmnCompact: (value, facts) => {
    const whole = BigInt(value) / 10n ** BigInt(facts.token.decimals);
    for (const [step, suffix] of [[1_000_000_000n, 'B'], [1_000_000n, 'M'], [1_000n, 'K']]) {
      if (whole >= step && whole % step === 0n) return `${groups.format(whole / step)} ${suffix}`;
    }
    return groups.format(whole);
  },
  pct: (value) => formatPercent(value),
  percent: (value) => formatPercent(value),
  commas: (value) => groups.format(BigInt(value)),
  blocks: (value, facts) => formatBlocks(value, facts),
  /** Blocks → whole days: 100,800 blocks → "7 days". */
  days: (value, facts) => {
    const days = blockSeconds(value, facts) / 86400n;
    return `${groups.format(days)} day${days === 1n ? '' : 's'}`;
  },
  /** Blocks → whole hours with the unit: 3,600 blocks → "6 h". */
  hours: (value, facts) => `${groups.format(blockSeconds(value, facts) / 3600n)} h`,
  /** Blocks → the whole hours as a bare figure, for "a {{…|hoursN}}-hour period". */
  hoursN: (value, facts) => groups.format(blockSeconds(value, facts) / 3600n),
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
 * from. Identifiers (`key`, `id`, `href`, `chainRefs`, `sources`) are
 * excluded: they are checked structurally instead.
 */
export function proseOf(content) {
  const skip = new Set(['key', 'id', 'href', 'chainRefs', 'sources', 'thesisSources']);
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

// TRANSITIONAL: the old site nav, kept only because src/observatory.mjs still
// imports it; the network phase replaces that page and the integrator removes this.
const NAV = [
  { key: 'overview', label: 'Overview', href: './' },
  { key: 'observatory', label: 'Observatory', href: 'observatory' },
  { key: 'docs', label: 'Docs', href: 'https://scalarnet.io/docs/' },
];
export function renderNav(current, extra = []) {
  const items = [...NAV, ...extra]
    .map((item) => `<li><a href="${escapeHtml(item.href)}"${item.key === current ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`)
    .join('');
  return `    <nav class="site-nav" aria-label="Site"><ul>${items}</ul></nav>`;
}

// ── the home page ────────────────────────────────────────────────────────────

/** The words of the chrome's own labels on this page: the diagram's and the live row's. */
export const LABELS = {
  stale: 'Stale',
  testnet: 'Testnet',
  flow: ['Register', 'Agree and escrow', 'Get paid'],
};

/** The section ids, in page order; test/home.test.mjs holds the page to them. */
export const SECTION_IDS = ['network-now', 'how-it-works', 'on-chain', 'token', 'status', 'build'];

/** A sentence's `sources` must name rows of source-claims.mjs; an unknown key throws like an unresolved placeholder. */
function cite(sources, known, where) {
  for (const key of sources ?? []) {
    if (!known.has(key)) throw new Error(`${where} cites source claim "${key}", which src/source-claims.mjs does not pin`);
  }
}

const textButton = (action) => `<div>${button({ text: action.text, href: action.href, variant: 'text' })}</div>`;

/** 1. The hero: display headline, one lead sentence, two buttons, one caption with the Testnet badge. */
function hero(content, facts) {
  const h = content.hero;
  return `<section class="sc-section" aria-labelledby="hero-h">
  <div class="sc-container home-hero">
    <h1 class="sc-display" id="hero-h">${fill(h.headline, facts)}</h1>
    <p class="sc-lead">${fill(h.lead, facts)}</p>
    <div class="sc-actions">${button({ text: h.primary.text, href: h.primary.href })}${button({ text: h.secondary.text, href: h.secondary.href, variant: 'secondary' })}</div>
    <p class="home-hero-caption sc-caption">${badge(LABELS.testnet)}<span>${fill(h.caption, facts)}</span></p>
  </div>
</section>`;
}

/** 2. Network right now: four stats from the build, refreshed in place by refresh.js. */
function networkSection(content, facts) {
  const n = content.network;
  const items = n.stats.map((s) => ({
    key: s.key,
    label: text(s.label, facts),
    value: fill(s.value, facts),
    caption: s.caption ? fill(s.caption, facts) : null,
  }));
  const warning = callout({
    variant: 'warning',
    body: `<span data-live-reason></span>`,
  });
  return section({
    id: SECTION_IDS[0],
    title: n.title,
    body: `<div class="home-live" data-live="${escapeHtml(API_V1)}">
      <div hidden data-live-warning>${warning}</div>
      <div>${stats(items, { label: n.title })}<p class="sc-stats-foot"><span hidden data-live-stale>${badge(LABELS.stale)} </span><span data-live-updated>${fill(n.builtCaption, facts)}</span></p></div>
      ${textButton(n.action)}
    </div>`,
  });
}

/** The one static diagram: three boxes and two arrows, the steps' words, drawn twice (a row, a column) in CSS pixels. */
function diagram(words) {
  const [a, b, c] = words.map(escapeHtml);
  const row = `<g class="home-flow-row">
      <rect x="0.5" y="0.5" width="175" height="63" rx="8"/><text x="88" y="32" text-anchor="middle" dominant-baseline="central">${a}</text>
      <path d="M176 32h23M193 27l6 5-6 5"/>
      <rect x="200.5" y="0.5" width="175" height="63" rx="8"/><text x="288" y="32" text-anchor="middle" dominant-baseline="central">${b}</text>
      <path d="M376 32h23M393 27l6 5-6 5"/>
      <rect x="400.5" y="0.5" width="175" height="63" rx="8"/><text x="488" y="32" text-anchor="middle" dominant-baseline="central">${c}</text>
    </g>`;
  const column = `<g class="home-flow-column">
      <rect x="0.5" y="0.5" width="239" height="63" rx="8"/><text x="120" y="32" text-anchor="middle" dominant-baseline="central">${a}</text>
      <path d="M120 64v17M115 75l5 6 5-6"/>
      <rect x="0.5" y="81.5" width="239" height="63" rx="8"/><text x="120" y="113" text-anchor="middle" dominant-baseline="central">${b}</text>
      <path d="M120 145v17M115 156l5 6 5-6"/>
      <rect x="0.5" y="162.5" width="239" height="63" rx="8"/><text x="120" y="194" text-anchor="middle" dominant-baseline="central">${c}</text>
    </g>`;
  return `<svg class="home-flow" role="img" aria-label="${escapeHtml(`${words[0]}, then ${words[1].toLowerCase()}, then ${words[2].toLowerCase()}`)}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
    ${row}
    ${column}
  </svg>`;
}

/** 3. How it works: three numbered steps, then the diagram. */
function howSection(content, facts, known) {
  const steps = content.how.steps
    .map((s, i) => {
      cite(s.sources, known, `how.steps[${i}]`);
      return `<li class="home-step"><h3 class="sc-h3">${i + 1}. ${fill(s.title, facts)}</h3><p class="sc-body sc-muted">${fill(s.text, facts)}</p></li>`;
    })
    .join('\n      ');
  return section({
    id: SECTION_IDS[1],
    title: content.how.title,
    body: `<ol class="sc-cols-3">
      ${steps}
    </ol>
    ${diagram(LABELS.flow)}`,
  });
}

/** 4. What's on chain: the runtime modules in plain words, one sentence each, and the reference link. */
function onChainSection(content, facts, known) {
  const o = content.onChain;
  const rows = o.rows.map((r, i) => {
    cite(r.sources, known, `onChain.rows[${i}]`);
    for (const ref of r.chainRefs) {
      if (!facts.pallets.some((p) => p.name === ref)) throw new Error(`content cites pallet "${ref}", which the metadata does not list`);
    }
    return [fill(r.label, facts), fill(r.text, facts)];
  });
  return section({
    id: SECTION_IDS[2],
    title: o.title,
    body: `<div class="sc-stack">
      ${table({ columns: o.columns.map((label) => ({ label })), rows, caption: text(o.title, facts) })}
      ${textButton(o.action)}
    </div>`,
  });
}

/** 5. Token: the key/value table, the thesis, the oracle caveat, the token-model link. */
function tokenSection(content, facts, known) {
  const t = content.token;
  cite(t.thesisSources, known, 'token.thesis');
  cite(t.caveat.sources, known, 'token.caveat');
  return section({
    id: SECTION_IDS[3],
    title: t.title,
    body: `<div class="sc-stack">
      ${kvTable(t.rows.map((r) => [text(r.label, facts), fill(r.value, facts)]), { caption: text(t.title, facts) })}
      <p class="sc-body">${fill(t.thesis, facts)}</p>
      <p class="sc-body sc-muted" data-caveat="${escapeHtml(t.caveat.key)}">${fill(t.caveat.text, facts)}</p>
      ${textButton(t.action)}
    </div>`,
  });
}

/** 6. Status and known issues: the testnet notice and the economic gate, in three sentences. */
function statusSection(content, facts, known) {
  const s = content.status;
  cite(s.gate.sources, known, 'status.gate');
  return section({
    id: SECTION_IDS[4],
    title: s.title,
    body: `<div class="sc-stack">
      ${callout({ variant: 'warning', body: fill(s.notice, facts) })}
      <p class="sc-body" data-caveat="${escapeHtml(s.gate.key)}">${fill(s.gate.text, facts)}</p>
      ${textButton(s.action)}
    </div>`,
  });
}

/** 7. Build on it: three cards and the two endpoints. */
function buildSection(content, facts) {
  const b = content.build;
  const values = { rpc: RPC_WSS, api: API_V1 };
  const endpoints = b.endpoints
    .map((e) => {
      if (!values[e.key]) throw new Error(`no address for endpoint "${e.key}"`);
      return `<li><span class="sc-muted">${fill(e.label, facts)}</span><code class="sc-mono">${escapeHtml(values[e.key])}</code></li>`;
    })
    .join('');
  return section({
    id: SECTION_IDS[5],
    title: b.title,
    body: `<div class="sc-stack">
      <div class="sc-cols-3">${b.cards.map((c) => card({ title: text(c.title, facts), body: fill(c.text, facts), action: c.action })).join('')}</div>
      <ul class="home-endpoints">${endpoints}</ul>
    </div>`,
  });
}

/** The whole page, as a string. Throws rather than emit a page with an unresolved claim. */
export function renderPage({ facts, content, sourceClaims, builtAt = null }) {
  const known = new Set((sourceClaims ?? []).map((row) => row.key));
  const body = [
    hero(content, facts),
    networkSection(content, facts),
    howSection(content, facts, known),
    onChainSection(content, facts, known),
    tokenSection(content, facts, known),
    statusSection(content, facts, known),
    buildSection(content, facts),
  ].join('\n');
  return page({
    title: text(content.meta.title, facts),
    description: text(content.meta.description, facts),
    path: '/',
    current: null,
    facts,
    builtAt: builtAt ?? facts.provenance.fetchedAt,
    body,
    scripts: ['/refresh.js'],
    extraHead: `\n<style>${homeCss()}</style>`,
  });
}
