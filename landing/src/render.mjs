// Renders the home page from chain facts + content. Pure: no I/O, no clock,
// no network — everything the page says is a function of chain-facts.json and
// src/content.mjs, which is what makes the honesty tests meaningful. The layout
// is Nightwatch (src/chrome); every figure is a Reading with its source.
import { escapeHtml } from './chrome/html.mjs';
import { band, code, copy, curve, footer, formatInt, leader, reading, tag, topBar, utc, utcDay } from './chrome/templates.mjs';
import { curvePaths, sample } from './chrome/curve.mjs';
import { ledgerRows as ledgerOf } from './source-claims.mjs';

export { escapeHtml };

const groups = new Intl.NumberFormat('en-US');

/** Every `{{token}}` in a string, filters included. */
export function placeholdersIn(str) {
  return [...String(str).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim());
}

/** Plancks → token units, grouped; exact by default, truncated to whole units when asked. */
function formatTokens(plancks, decimals, { truncate = false } = {}) {
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(plancks);
  const whole = groups.format(value / scale);
  if (truncate) return whole;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Basis points → percent, e.g. 25 → "0.25%", 3,000 → "30%". Bps are the chain's unit; percent is the reader's. */
function formatPercent(bps) {
  const percent = Number(bps) / 100;
  return `${Number(percent.toFixed(4))}%`;
}

/** Blocks → a human duration, derived from the chain's own expected block time. */
function formatBlocks(blocks, facts) {
  const blockMs = BigInt(facts.constants.babe.expectedBlockTime);
  const seconds = (BigInt(blocks) * blockMs) / 1000n;
  const units = [
    ['day', 86400n],
    ['hour', 3600n],
    ['minute', 60n],
    ['second', 1n],
  ];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const whole = seconds / size;
      const remainder = seconds % size;
      const label = `${groups.format(whole)} ${name}${whole === 1n ? '' : 's'}`;
      return remainder === 0n ? label : `over ${label}`;
    }
  }
  return `${groups.format(seconds)} seconds`;
}

const blockSeconds = (blocks, facts) => (BigInt(blocks) * BigInt(facts.constants.babe.expectedBlockTime)) / 1000n;

const FILTERS = {
  cmn: (value, facts) => formatTokens(value, facts.token.decimals),
  cmnFloor: (value, facts) => formatTokens(value, facts.token.decimals, { truncate: true }),
  /** Whole tokens in thousands, millions or billions, e.g. 100,000,000,000 → "100 B": a figure that fits a narrow column; the full figure goes in its receipt. */
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
  /** Blocks → whole days, e.g. 100,800 blocks → "7 days". */
  days: (value, facts) => {
    const days = blockSeconds(value, facts) / 86400n;
    return `${groups.format(days)} day${days === 1n ? '' : 's'}`;
  },
  /** Blocks → whole hours, e.g. 3,600 blocks → "6 h". */
  hours: (value, facts) => `${groups.format(blockSeconds(value, facts) / 3600n)} h`,
  secs: (value) => groups.format(BigInt(value) / 1000n),
  short: (value) => `${String(value).slice(0, 10)}…${String(value).slice(-6)}`,
  /** An ISO instant → `YYYY-MM-DD HH:MM:SS UTC`. */
  utc: (value) => utc(value),
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
 * from. Identifiers (`key`, `id`, `status`, `chainRefs`, `path`, `name`) and
 * URLs are excluded: they are checked structurally instead.
 */
export function proseOf(content) {
  const skip = new Set(['key', 'id', 'status', 'url', 'chainRefs', 'path', 'name', 'state']);
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

// The old site nav, kept for the pages that still import it until their own
// phase moves them onto the chrome's top bar.
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

/** Every build-time figure's origin: the committed record, at its block and time. */
const recordSource = (facts, computed = null) => ({
  method: 'FILE',
  url: 'chain-facts.json',
  fetchedAt: facts.provenance.fetchedAt,
  block: facts.provenance.readAtBlock,
  raw: 'chain-facts.json',
  computed,
});

// The weight formula, a code block from the brief (section 5.1, item 6): code,
// not prose, so it lives here with the other fixed labels rather than in
// content.mjs, whose every string the digit test scans.
const FORMULA = 'weight = √stake × rank × activity × heartbeat × (1 + oracle) × (1 + onboarding) × (1 + velocity)';
const FORMULA_LINE = 'activity = floor + governance + β · work, and is zero without settled work this era';

const sectionHead = (number, heading) =>
  `<header class="nw-section-head"><span class="nw-figure nw-figure--l">${escapeHtml(number)}</span><h2 class="nw-h2">${escapeHtml(heading)}</h2></header>`;

const pad = (n) => String(n).padStart(2, '0');

function buildReading(r, facts, { size = 'm', state = 'record', stack = false } = {}) {
  return reading({
    stack,
    key: r.key,
    label: text(r.label, facts),
    figure: text(r.figure, facts),
    unit: r.unit ? text(r.unit, facts) : null,
    sub: r.sub ? text(r.sub, facts) : null,
    size,
    state: r.state ?? state,
    source: recordSource(facts, r.path ? `${r.full ? `${text(r.full, facts)} · ` : ''}${r.path} from the runtime metadata` : null),
  });
}

function hero(content, facts) {
  const eyebrow = `LAYER 1 · RUNTIME SPEC ${escapeHtml(facts.provenance.specVersion)} · TESTNET`;
  return `<section class="nw-section nw-hero" aria-labelledby="hero-h">
  <div class="nw-frame nw-grid">
    <div class="nw-hero-text">
      <p class="nw-label nw-eyebrow">${eyebrow}</p>
      <h1 class="nw-display" id="hero-h">${fill(content.hero.headline, facts)}</h1>
      <p class="nw-body">${fill(content.hero.sentence, facts)}</p>
    </div>
    <div class="nw-hero-readings nw-stack">
${content.hero.readings.map((r) => buildReading(r, facts, { size: 'l' })).join('\n')}
    </div>
  </div>
</section>`;
}

/** The last blocks as built: one 3 px bar per block, as tall as its extrinsic count, the FINAL marker. */
function river(content, facts) {
  const blocks = [...facts.state.recentBlocks].reverse();
  const width = 1200;
  const height = 140;
  const pitch = width / blocks.length;
  const max = Math.max(1, ...blocks.map((b) => b.extrinsics));
  const newest = blocks.length - 1;
  const bars = blocks
    .map((b, i) => {
      const h = Math.max(2, Math.round((b.extrinsics / max) * (height - 28)));
      return `<rect class="nw-river-bar${i === newest ? ' is-newest' : ''}" x="${(i * pitch + pitch / 2 - 1.5).toFixed(1)}" y="${height - 16 - h}" width="3" height="${h}"><title>block ${formatInt(b.number)} · ${b.extrinsics} extrinsics${b.final ? ' · final' : ''}</title></rect>`;
    })
    .join('');
  const lastFinal = blocks.map((b) => b.final).lastIndexOf(true);
  const x = (lastFinal + 1) * pitch;
  // The label sits right of the rule, or left of it when the rule is near the strip's end.
  const label = lastFinal >= 0 ? `FINAL · ${formatInt(blocks[lastFinal].number)}` : '';
  const leftOf = x + 8 + label.length * 8 > width;
  const marker =
    lastFinal >= 0
      ? `<line class="nw-river-final" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${height - 16}"></line><text x="${(leftOf ? x - 8 : x + 8).toFixed(1)}" y="12"${leftOf ? ' text-anchor="end"' : ''} class="nw-curve-value">${label}</text>`
      : '';
  return `<figure class="nw-frame nw-river" aria-labelledby="river-h">
  <figcaption><h2 class="nw-label" id="river-h">${fill(content.river.title, facts)}</h2></figcaption>
  <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="The last ${blocks.length} blocks as built, one bar per block, as tall as its extrinsic count; the newest in full ink, the final marker a rule">${bars}${marker}</svg>
  <p class="nw-receipt-line nw-river-caption">${fill(content.river.caption, facts)}</p>
</figure>`;
}

function manifesto(content, facts) {
  const sqrt = curvePaths(sample(Math.sqrt, 0, 100, 40), { width: 1200, height: 240 });
  return `<section class="nw-section nw-manifesto" aria-labelledby="manifesto-h">
  <div class="nw-frame"><div class="nw-manifesto-sheet">
    <svg class="nw-manifesto-curve" viewBox="0 0 1200 240" preserveAspectRatio="none" aria-hidden="true"><path d="${sqrt.pathLine}" fill="none" stroke="var(--ink)" stroke-width="2"></path></svg>
    <p class="nw-display" id="manifesto-h">${fill(content.manifesto.display, facts)}</p>
    <p class="nw-body">${fill(content.manifesto.text, facts)}</p>
  </div></div>
</section>`;
}

/** The pallet's calls from the metadata, never typed: the `n calls ›` disclosure. */
function callsOf(refs, facts) {
  const calls = refs.flatMap((name) => {
    const pallet = facts.pallets.find((p) => p.name === name);
    if (!pallet) throw new Error(`content cites pallet "${name}", which the metadata does not list`);
    return pallet.calls.map((call) => `${name}.${call}`);
  });
  return calls;
}

function whatSection(section, facts, number) {
  const rows = section.bullets
    .map((row) => {
      const calls = callsOf(row.chainRefs, facts);
      return `      <li class="nw-what-row">
        <h3 class="nw-h3">${escapeHtml(row.name)}</h3>
        <p class="nw-body">${fill(row.text, facts)}</p>
        <details class="nw-calls"><summary class="nw-quiet">${formatInt(calls.length)} ${calls.length === 1 ? 'call' : 'calls'} ›</summary><ul class="nw-mono nw-dim">${calls.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></details>
      </li>`;
    })
    .join('\n');
  return `<section class="nw-section" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-h">
  <div class="nw-frame">
    ${sectionHead(number, section.heading).replace('<h2 class="nw-h2">', `<h2 class="nw-h2" id="${escapeHtml(section.id)}-h">`)}
    <ol class="nw-what">
${rows}
    </ol>
  </div>
</section>`;
}

function tokenSection(section, facts, number) {
  return `<section class="nw-section" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-h">
  <div class="nw-frame">
    ${sectionHead(number, section.heading).replace('<h2 class="nw-h2">', `<h2 class="nw-h2" id="${escapeHtml(section.id)}-h">`)}
    <div class="nw-row nw-token-row">
${section.readings.map((r) => buildReading(r, facts, { size: 'm', stack: true })).join('\n')}
    </div>
  </div>
</section>`;
}

/** The four curves of the weight formula, computed at build from the constants and the pallet's own steps. */
function curvesOf(facts) {
  const blockTimeMs = Number(facts.constants.babe.expectedBlockTime);
  const graceHours = (Number(facts.constants.agents.heartbeatGracePeriod) * blockTimeMs) / 3_600_000;
  const decayHours = (Number(facts.constants.agents.heartbeatDecayPeriod) * blockTimeMs) / 3_600_000;
  // pallets/agents/src/lib.rs:2003–2004: pct = 100 − 90 × over / decay, floored at 10.
  const heartbeat = (h) => (h <= graceHours ? 100 : Math.max(10, 100 - (90 * (h - graceHours)) / decayHours));
  // pallets/emissions/src/lib.rs:802–810: the diversity staircase in basis points by distinct buyers.
  const stairs = [0, 1_000, 3_000, 6_000, 8_000, 10_000].map((bps, buyers) => [buyers, bps / 100]);
  stairs.push([stairs.length, 100]);
  return [
    { key: 'sqrt', points: sample(Math.sqrt, 0, 100, 40), yMax: 10, labels: ['10', '5', '0'], source: 'pallets/emissions/src/lib.rs:673 · let sqrt_stake = integer_sqrt(stake_u128);' },
    { key: 'log', points: sample((x) => Math.log2(Math.max(1, x)), 1, 1024, 60), yMax: 10, labels: ['10', '5', '0'], source: 'pallets/emissions/src/lib.rs:688 · let raw_vol = log2_scaled(vol_u128, unit_u128);' },
    { key: 'diversity', points: stairs, yMax: 100, step: true, labels: ['100 %', '50 %', '0'], source: 'pallets/emissions/src/lib.rs:802–810 · fn diversity_score_bps' },
    { key: 'heartbeat', points: sample(heartbeat, 0, graceHours + decayHours, 80), yMax: 100, labels: ['100 %', '55 %', '10 %'], source: 'pallets/agents/src/lib.rs:1987–2004 · heartbeat_multiplier' },
  ];
}

function rewardsSection(section, facts, number) {
  const curves = curvesOf(facts);
  const figures = section.curves
    .map((c) => {
      const data = curves.find((d) => d.key === c.key);
      const paths = curvePaths(data.points, { width: 400, height: 120, yMax: data.yMax, step: data.step });
      return `      <div class="nw-curve-card">
        <h3 class="nw-h3">${fill(c.title, facts)}</h3>
        ${curve({ id: c.key, width: 400, height: 120, pathLine: paths.pathLine, pathArea: paths.pathArea, end: paths.end, labels: data.labels, alt: `${text(c.title, facts)}: ${text(c.caption, facts)}`, table: data.points.filter((_, i) => i % Math.ceil(data.points.length / 6) === 0).map(([x, y]) => [String(Math.round(x)), String(Math.round(y))]) })}
        <p class="nw-small nw-dim">${fill(c.caption, facts)}</p>
        <p class="nw-receipt-line nw-curve-source">${escapeHtml(data.source)}</p>
      </div>`;
    })
    .join('\n');
  const caveats = (section.caveats ?? []).map((c) => `    <p class="nw-small nw-dim nw-caveat" data-caveat="${escapeHtml(c.key)}">${fill(c.text, facts)}</p>`).join('\n');
  return `<section class="nw-section" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-h">
  <div class="nw-frame">
    ${sectionHead(number, section.heading).replace('<h2 class="nw-h2">', `<h2 class="nw-h2" id="${escapeHtml(section.id)}-h">`)}
    <div class="nw-row nw-curves">
${figures}
    </div>
    ${code({ text: `${FORMULA}\n${FORMULA_LINE}` })}
${caveats}
  </div>
</section>`;
}

function networkSection(section, facts, number) {
  const caveats = (section.caveats ?? []).map((c) => `    <p class="nw-small nw-dim nw-caveat" data-caveat="${escapeHtml(c.key)}">${fill(c.text, facts)}</p>`).join('\n');
  return `<section class="nw-section" id="${escapeHtml(section.id)}" aria-labelledby="${escapeHtml(section.id)}-h">
  <div class="nw-frame">
    ${sectionHead(number, section.heading).replace('<h2 class="nw-h2">', `<h2 class="nw-h2" id="${escapeHtml(section.id)}-h">`)}
    <div class="nw-row">
${section.readings.map((r) => buildReading(r, facts, { size: 'l', stack: true })).join('\n')}
    </div>
    <div class="nw-rule-vermilion nw-gate" data-caveat="${escapeHtml(section.gate.key)}">
      <p class="nw-label">${fill(section.gate.label, facts)}</p>
      <p class="nw-body">${fill(section.gate.text, facts)}</p>
    </div>
${caveats}
  </div>
</section>`;
}

function whereSection(content, facts, number) {
  const items = content.links
    .map((link) => {
      const shown = link.url.replace(/^https:\/\//, '').replace(/\/$/, '');
      const planned = link.status === 'planned';
      return `      <div data-link="${escapeHtml(link.key)}" data-status="${escapeHtml(link.status)}">
${reading({ key: `link-${link.key}`, label: text(link.label, facts), figure: shown, size: 's', href: link.url, state: 'record', source: { method: 'LINK', url: link.url, fetchedAt: facts.provenance.fetchedAt, block: facts.provenance.readAtBlock, raw: null } })}
        ${planned ? tag({ state: 'record', text: 'planned' }) : ''}
      </div>`;
    })
    .join('\n');
  return `<section class="nw-section" id="links" aria-labelledby="links-h">
  <div class="nw-frame">
    ${sectionHead(number, content.where.heading).replace('<h2 class="nw-h2">', '<h2 class="nw-h2" id="links-h">')}
    <div class="nw-where">
${items}
    </div>
  </div>
</section>`;
}

const ledgerRow = (row) => `      <li class="nw-ledger-claim">
        <div class="nw-reading-line"><span class="nw-body">${escapeHtml(row.claim)}</span>${leader()}<span class="nw-mono nw-dim">${escapeHtml(row.file)}:${row.line}</span></div>
        <figure class="nw-code nw-copyable"><pre><code>${escapeHtml(row.snippet)}</code></pre>${copy(row.snippet, 'Copy this line')}</figure>
      </li>`;

function verificationSection(content, sourceClaims, facts, number) {
  const rows = ledgerOf.length ? ledgerOf : sourceClaims;
  const shown = rows.slice(0, 6);
  const rest = rows.slice(6);
  return `<section class="nw-section" id="verification" aria-labelledby="verification-h">
  <div class="nw-frame">
    ${sectionHead(number, content.verification.heading).replace('<h2 class="nw-h2">', '<h2 class="nw-h2" id="verification-h">')}
    <ol class="nw-ledger-claims">
${shown.map(ledgerRow).join('\n')}
    </ol>
    ${rest.length ? `<details class="nw-more"><summary class="nw-quiet">${formatInt(rest.length)} more ›</summary><ol class="nw-ledger-claims" start="${shown.length + 1}">\n${rest.map(ledgerRow).join('\n')}\n    </ol></details>` : ''}
  </div>
</section>`;
}

/** The whole page, as a string. Throws rather than emit a page with an unresolved claim. */
export function renderPage({ facts, content, sourceClaims, builtAt = null }) {
  const sectionsHtml = [];
  let n = 0;
  for (const section of content.sections) {
    n += 1;
    const number = pad(n);
    if (section.id === 'what') sectionsHtml.push(whatSection(section, facts, number));
    else if (section.id === 'token') sectionsHtml.push(tokenSection(section, facts, number));
    else if (section.id === 'rewards') sectionsHtml.push(rewardsSection(section, facts, number));
    else if (section.id === 'network') sectionsHtml.push(networkSection(section, facts, number));
    else throw new Error(`no renderer for section "${section.id}"`);
  }
  sectionsHtml.push(whereSection(content, facts, pad((n += 1))));
  sectionsHtml.push(verificationSection(content, sourceClaims, facts, pad((n += 1))));

  const facts_ = {
    genesisHash: facts.provenance.genesisHash,
    specVersion: facts.provenance.specVersion,
    nodeVersion: facts.provenance.nodeVersion ?? null,
    builtAt: builtAt ?? facts.provenance.fetchedAt,
    block: facts.provenance.readAtBlock,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fill(content.meta.title, facts)}</title>
<meta name="description" content="${fill(content.meta.description, facts)}">
<meta name="color-scheme" content="dark">
<link rel="preload" href="fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="styles.css">
</head>
<body class="nw-home">
${topBar({ current: 'home', lampHtml: tag({ state: 'built', text: 'AS BUILT', detail: utcDay(facts_.builtAt) }) })}
<main>
${hero(content, facts)}
${river(content, facts)}
${manifesto(content, facts)}
${sectionsHtml.join('\n')}
</main>
${footer({ facts: facts_ })}
</body>
</html>
`;
}
