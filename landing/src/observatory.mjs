// Renders /observatory — the static frame the live instruments draw into,
// in the Ledger chrome (src/chrome).
//
// The landing page states figures read off a node at build time. The
// observatory states nothing at build time except three checked-in records,
// each labelled as a record: the runtime upgrade history, the security
// posture file and the hosts record. Every other figure is fetched in the
// reader's browser by src/observatory/main.js: each is a chrome Reading whose
// source (endpoint, fetch time, block, raw bytes) is declared here from
// data.js and filled in the browser. So this renderer emits empty reading
// slots, never a value — test/observatory.test.mjs holds it to that.

import { readFileSync } from 'node:fs';
import { escapeHtml, renderNav } from './render.mjs';
import { storageKey } from './observatory/scale.js';
import * as T from './chrome/templates.mjs';
import { SOURCES, API_ORIGIN, RPC_URL } from './observatory/data.js';

/** The second live page, /pulse, linked from this page's nav (its own module imports this one, so the item lives here). */
export const PULSE_NAV = { key: 'pulse', label: 'Pulse', href: 'pulse' };

export const API_HOST = 'api.scalarnet.io';
export const RPC_WSS = 'wss://rpc.scalarnet.io';
export const RPC_HTTPS = 'https://rpc.scalarnet.io';
export const CHAINSPEC_URL = 'https://scalarnet.io/docs/chainspec.json';
export const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4';
// The explorer's activity feed (explorer/src/routes.ts, `activity`), which
// takes `?agent=<address>` to filter to one agent.
export const EXPLORER_URL = 'https://explorer.scalarnet.io/activity';

// ── pre-Nightwatch helpers, still consumed by src/pulse.mjs (Phase 4 retires them) ──

export const MARK_PATHS =
  '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.25"/>' +
  '<path d="M12 1v4.5M12 18.5V23M1 12h4.5M18.5 12H23" fill="none" stroke="currentColor" stroke-width="1.25"/>' +
  '<circle cx="12" cy="12" r="1.75" fill="currentColor"/>';

export function mark() {
  return `<svg class="mark" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">${MARK_PATHS}</svg>`;
}

export function wordmark({ tag = 'a', href = 'observatory', className = '' } = {}) {
  const attrs = tag === 'a' ? ` href="${escapeHtml(href)}"` : '';
  return `<${tag} class="wordmark${className ? ` ${className}` : ''}"${attrs}>${mark()}<span class="wordmark-text">Scalar Commons</span></${tag}>`;
}

const skeleton = (inline = false) =>
  `<span class="skeleton${inline ? ' skeleton-inline' : ''}" aria-hidden="true"></span><span class="visually-hidden">Loading</span>`;

/** The pre-Nightwatch reading slot; /pulse still renders with it. */
export function reading({ key, label, live = true, className = '', minSpec = null }) {
  const liveAttrs = live ? ' aria-live="polite" aria-atomic="true"' : '';
  const gate = Number.isFinite(minSpec) ? ` data-min-spec="${minSpec}" hidden` : '';
  return `        <div class="reading${className ? ` ${className}` : ''}" data-reading="${escapeHtml(key)}"${gate}>
          <p class="reading-value is-loading"${liveAttrs}>${skeleton()}</p>
          <p class="reading-label">${escapeHtml(label)}</p>
          <p class="reading-prov"></p>
        </div>`;
}

export function copyButton(value, label) {
  return `<button type="button" class="btn copy" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}" hidden>Copy</button>`;
}

export const SOURCES_BOOT =
  '<script>try{if(localStorage.getItem("observatory:sources")==="1")document.documentElement.setAttribute("data-sources","")}catch(e){}</script>';

/** The pre-Nightwatch head; /pulse still renders with it. */
export function renderHead({ title, description, css = null, scripts = true, script = 'observatory.js', boot = scripts }) {
  const styles = css === null ? `<link rel="stylesheet" href="${script.replace(/\.js$/, '.css')}">` : `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="dark">
${boot ? SOURCES_BOOT : ''}
<link rel="preload" href="fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://${API_HOST}" crossorigin>
${styles}
${scripts && script === 'observatory.js' ? '<script type="module" src="observatory.js"></script>' : ''}`;
}

/** Ordinal marker positions along a horizontal rail; kept for the library test. */
export function railPositions(count, { first = 8, last = 92 } = {}) {
  if (count <= 0) return [];
  if (count === 1) return [(first + last) / 2];
  return Array.from({ length: count }, (_, i) => first + (i * (last - first)) / (count - 1));
}

export { renderNav };

// ── the Nightwatch page ──────────────────────────────────────────────────────

/** Where Session.Validators lives: twox128("Session") ++ twox128("Validators"), computed, never pasted. */
const SESSION_VALIDATORS_KEY = storageKey('Session', 'Validators');

/**
 * The declared source of a reading, from data.js: the endpoint the browser
 * will read it from, with fetchedAt/block/raw null until it has. A key no
 * source feeds throws, so a Reading without an origin fails the build.
 */
export function sourceFor(key) {
  const entry = Object.values(SOURCES).find((s) => s.readings?.includes(key));
  if (!entry) throw new Error(`reading "${key}" has no source in data.js`);
  if (entry.kind === 'api') return { method: 'GET', url: new URL(entry.path, API_ORIGIN).href, fetchedAt: null, block: null, raw: null };
  if (entry.kind === 'github') return { method: 'GET', url: entry.url, fetchedAt: null, block: null, raw: null };
  return { method: 'WS', url: `${RPC_URL}/${entry.method ?? entry.label}`, fetchedAt: null, block: null, raw: null };
}

/**
 * One live Reading: the chrome's template with its declared source, no
 * figure, and the three hooks the honesty tests and the instruments read —
 * `reading-value` on the figure, `reading-label` on the label, and an empty
 * `reading-prov` line that the readout fills.
 */
export function nwReading({ key, label, size = 'm', sub = null, className = '', minSpec = null, stack = true }) {
  // The stub is CONNECTING until the browser's first read; the readout then sets LIVE, or RECORD on a failed read.
  let html = T.reading({ key, label, size, sub, className, stack, live: true, figure: null, state: 'connecting', source: sourceFor(key) });
  html = html
    .replace('<span class="nw-label">', '<span class="nw-label reading-label">')
    .replace(/class="nw-figure nw-figure--([a-z]+)"/, 'class="reading-value nw-figure nw-figure--$1"')
    .replace(/<\/div>$/, '  <p class="reading-prov"></p>\n</div>');
  // `hidden` from the start: instruments/messaging.js reveals it once the
  // chain reports a high enough spec_version.
  if (Number.isFinite(minSpec)) html = html.replace(`data-reading="${key}"`, `data-reading="${key}" data-min-spec="${minSpec}" hidden`);
  return html;
}

/** One section below the first screen: the number and the name as a label, then its instrument and its Readings. */
function section({ id, name, number, title, instrument = '', readings = '', notes = '' }) {
  return `  <section id="${id}" class="section nw-section" data-instrument="${name}" data-present-screen aria-labelledby="${id}-h">
    <div class="nw-frame section-grid">
      <h2 class="nw-label section-head" id="${id}-h">${number} · ${escapeHtml(title)}</h2>
${instrument ? `      <div class="instrument">\n${instrument}\n      </div>\n` : ''}${readings ? `      <div class="readings nw-row">\n${readings}\n      </div>\n` : ''}${notes ? `      <div class="notes">\n${notes}\n      </div>\n` : ''}    </div>
  </section>`;
}

// ── sections ─────────────────────────────────────────────────────────────────

function chainSection() {
  return section({
    id: 'chain',
    title: 'Chain',
    name: 'pulse',
    number: '01',
    // The river is drawn once, under the first screen (.hero-river); this section keeps only its status line.
    instrument: `        <p class="pulse-status nw-visually-hidden" role="status"></p>`,
    readings: [
      nwReading({ key: 'bestBlock', label: 'Height', size: 'l' }),
      nwReading({ key: 'finalizedBlock', label: 'Finalized', size: 'l' }),
      nwReading({ key: 'finalityLag', label: 'Finality lag', size: 'l' }),
      nwReading({ key: 'blocksPerMinute', label: 'Blocks per minute', size: 'l' }),
    ].join('\n'),
  });
}

/** The Day Bar's frame: four empty segments the browser fills from /v1/eras and /v1/eras/current. */
function dayBarFrame() {
  return T.dayBar({
    segments: [0, 1, 2, 3].map((i) => ({ era: null, label: '', fill: 0, current: i === 3 })),
    valueNow: 0,
    valueMax: 3600,
    ariaLabel: 'The last three settled eras and the current one',
  });
}

function economySection() {
  return section({
    id: 'economy',
    title: 'Economy',
    name: 'era',
    number: '02',
    instrument: `        ${dayBarFrame()}`,
    readings: [
      nwReading({ key: 'eraCountdown', label: 'Time to settlement', size: 'l' }),
      nwReading({ key: 'agentPayouts', label: 'Issued to agents to date', size: 'l' }),
      nwReading({ key: 'openDisputes', label: 'Open disputes', size: 'l', className: 'reading-disputes' }),
    ].join('\n'),
  });
}

/**
 * Who runs the validators, and where. Written by the operators in
 * public/status.json, never read from the chain, and shown with the Validators
 * notes under the same "Record, not live" label as the posture record.
 */
export function statusRecord(status) {
  const entry = status?.fields?.hosts;
  if (!entry?.value || !entry.asOf || !entry.source) {
    throw new Error('public/status.json has no hosts record with value, asOf and source');
  }
  return `        <p class="instrument-note status-record" data-record="true" data-status="hosts"><span class="status-label">Record, not live · Who runs them:</span> <span class="status-value">${escapeHtml(entry.value)}</span> <span class="dim mono">as of ${escapeHtml(entry.asOf)}</span> <span class="posture-source">${escapeHtml(entry.source)}</span> <a href="status.json" class="mono">landing/public/status.json</a></p>`;
}

function validatorsSection(status) {
  return section({
    id: 'validators',
    title: 'Validators',
    name: 'validators',
    number: '03',
    instrument: `        <div class="ring-host">
          <svg class="ring" role="img" aria-label="The active validators as points on a ring"></svg>
        </div>
        <ol class="validator-list"></ol>`,
    readings: [nwReading({ key: 'validators', label: 'Active set', size: 'l' }), nwReading({ key: 'nodeHealth', label: 'Node health', size: 'l' })].join('\n'),
    notes: `        <p class="instrument-note ring-note"></p>
${statusRecord(status)}`,
  });
}

/** One history strip: its label, the plot the instrument draws into, and the figure with its receipt line. */
function strip({ key, label }) {
  const source = sourceFor(key);
  return `          <figure class="strip reading" data-reading="${escapeHtml(key)}">
            <figcaption><h3 class="nw-label reading-label">${escapeHtml(label)}</h3></figcaption>
            <div class="strip-plot" data-plot></div>
            <p class="reading-value nw-figure nw-figure--m" aria-live="polite" aria-atomic="true"></p>
            ${T.receiptLine(source)}
            <p class="reading-prov"></p>
          </figure>`;
}

function historySection() {
  return section({
    id: 'history',
    title: 'History',
    name: 'history',
    number: '04',
    instrument: `        <div class="strips nw-row">
${[
  strip({ key: 'blockTime', label: 'Block time' }),
  strip({ key: 'agreementsCumulative', label: 'Agreements opened' }),
  strip({ key: 'emissionCumulative', label: 'CMN issued to agents' }),
  strip({ key: 'agentsOverTime', label: 'Registered agents' }),
].join('\n')}
        </div>`,
  });
}

/** The upgrade record as Rail entries, newest on top; the one in force carries the lit tick. */
function upgradeRail(history) {
  const rows = [...history.upgrades].reverse();
  const inForce = rows.find((u) => u.status === 'applied');
  const entries = rows.map((u) => {
    const applied = u.status === 'applied';
    const html = `<div class="upgrade" data-spec="${u.specVersion}" data-status="${escapeHtml(u.status)}">
              <p class="upgrade-title"><span class="nw-h3 upgrade-spec">${u.specVersion}</span> ${T.tag({ state: applied ? 'sealed' : 'record', text: applied ? `SEALED · BLOCK ${T.formatInt(u.appliedAtBlock)}` : 'RECORD' })}</p>
              <p class="nw-body upgrade-change">${escapeHtml(u.summary)}</p>
              <p class="nw-mono upgrade-facts">${applied ? `<span class="confirm" data-confirm-block="${u.appliedAtBlock}" data-block-hash="${escapeHtml(u.blockHash)}">checking the chain…</span>` : ''}</p>
              ${u.wasm ? `<p class="nw-mono upgrade-hash nw-copyable"><span class="nw-label">wasm sha256</span> <code class="hash">${escapeHtml(u.wasm.sha256)}</code> ${T.copy(u.wasm.sha256, `Copy sha256 of runtime ${u.specVersion}`)}</p>` : ''}
            </div>`;
    return { time: applied ? u.date : 'scheduled', state: u === inForce ? 'newest' : applied ? 'final' : null, html };
  });
  return T.rail({ entries, className: 'upgrade-rail' });
}

function upgradesSection(history) {
  return section({
    id: 'upgrades',
    title: 'Upgrades',
    name: 'upgrades',
    number: '05',
    instrument: `        <p class="nw-small nw-dim">Each runtime upgrade in order — a checked-in record, re-confirmed against the chain as the page loads.</p>
${upgradeRail(history)}
        <p class="nw-small nw-dim upgrade-gap">308 was never shipped</p>`,
    readings: [nwReading({ key: 'specVersion', label: 'Runtime in force', size: 'l' }), nwReading({ key: 'lastUpgrade', label: 'In force since block', size: 'l' })].join('\n'),
  });
}

const POSTURE_FIELDS = [
  ['findingsExamined', 'Findings examined'],
  ['fixedIn307', 'Fixed in runtime 307'],
  ['redTeamStatus', 'Red-team exercise'],
  ['lastRehearsal', 'Last upgrade rehearsal'],
];

/**
 * The security posture: four entries written by the operators, not read from
 * the chain. Each recorded value names the document in this repository it
 * was taken from and its date; an entry not yet recorded says so. No badge.
 */
function postureRecord(posture) {
  const rows = POSTURE_FIELDS.map(([key, label]) => {
    const entry = posture.fields?.[key] ?? {};
    const recorded = entry.value !== null && entry.value !== undefined;
    const value = recorded ? escapeHtml(String(entry.value)) : '<span class="not-recorded">not yet recorded</span>';
    const asOf = entry.asOf ? ` <span class="dim mono">as of ${escapeHtml(entry.asOf)}</span>` : '';
    const source = recorded && entry.source ? `<span class="posture-source nw-mono">${escapeHtml(entry.source)}</span>` : '';
    return `            <div class="posture-row" data-posture="${key}" data-recorded="${recorded}">
              <dt class="nw-label">${escapeHtml(label)}</dt>
              <dd><span class="posture-value">${value}</span>${asOf}${source}</dd>
            </div>`;
  }).join('\n');
  return `        <div class="posture-record" data-record="true">
          <h3 class="nw-label">Security posture · Record, not live</h3>
          <dl class="posture">
${rows}
          </dl>
          <p class="nw-small nw-dim"><a href="posture.json" class="nw-mono">landing/public/posture.json</a></p>
        </div>`;
}

function verifySection(history, posture) {
  const latestApplied = [...history.upgrades].reverse().find((u) => u.status === 'applied');
  const hashCommand =
    `curl -s -H 'content-type: application/json' \\\n` +
    `  -d '{"id":1,"jsonrpc":"2.0","method":"state_getStorage","params":["0x3a636f6465","${latestApplied.blockHash}"]}' \\\n` +
    `  ${RPC_HTTPS} \\\n` +
    `  | python3 -c 'import sys,json; sys.stdout.buffer.write(bytes.fromhex(json.load(sys.stdin)["result"][2:]))' \\\n` +
    `  | sha256sum`;
  const commands = [
    [`curl -s https://${API_HOST}/v1/status`, 'curl-status'],
    [`curl -s https://${API_HOST}/v1/eras/current`, 'curl-era'],
    [`curl -s https://${API_HOST}/v1/escrows/stats`, 'curl-escrow'],
    [`curl -s https://${API_HOST}/v1/emissions/supply`, 'curl-supply'],
    [hashCommand, 'curl-wasm'],
  ];
  return section({
    id: 'verify',
    title: 'Verify',
    name: 'verify',
    number: '06',
    instrument: `        <div class="verify nw-stack">
          <dl class="facts">
            <div class="fact" data-reading="genesis">
              <dt class="nw-label">Genesis hash</dt>
              <dd><span class="reading-value nw-mono"></span> <span class="reading-prov nw-receipt-line"></span></dd>
            </div>
            <div class="fact">
              <dt class="nw-label">Chain specification</dt>
              <dd><a class="nw-mono" href="${CHAINSPEC_URL}">${CHAINSPEC_URL.replace('https://', '')}</a></dd>
            </div>
            <div class="fact">
              <dt class="nw-label">RPC endpoint</dt>
              <dd><span class="nw-mono">${RPC_WSS}</span></dd>
            </div>
            <div class="fact">
              <dt class="nw-label">Indexer API</dt>
              <dd><a class="nw-mono" href="https://${API_HOST}/v1/status">${API_HOST}/v1</a></dd>
            </div>
            <div class="fact">
              <dt class="nw-label">Session.Validators storage key</dt>
              <dd><span class="nw-mono">${SESSION_VALIDATORS_KEY}</span></dd>
            </div>
          </dl>
${commands.map(([text, id]) => `          <div id="${id}">${T.code({ text, lang: 'sh' })}</div>`).join('\n')}
${postureRecord(posture)}
        </div>`,
  });
}

// ── the page ─────────────────────────────────────────────────────────────────

const SECTIONS = {
  chain: () => chainSection(),
  economy: () => economySection(),
  validators: ({ status }) => validatorsSection(status),
  history: () => historySection(),
  upgrades: ({ history }) => upgradesSection(history),
  verify: ({ history, posture }) => verifySection(history, posture),
};

/** One section on its own, by its id, for the instrument dev harness. */
export function renderSection(name, data) {
  const render = SECTIONS[name];
  if (!render) throw new Error(`no section named "${name}"; one of ${Object.keys(SECTIONS).join(', ')}`);
  return render(data);
}

/** Who runs the operator-run agents, said in plain words beside the figure, never behind a disclosure. */
export const OPERATOR_NOTE =
  'Agents run by the Scalar Commons team to exercise the network. Identified on-chain by the swarm- prefix.';

export const DEK = 'The public chain, read from a running node. Every figure names its source.';

/**
 * The presenter's comb Spine (round 1 §3): horizontal, 240 ticks across
 * 1,600 px, newest at the right, shown only in presenter mode at the foot of
 * every screen. Empty until the head bus fills it.
 */
function combFrame() {
  return `<div class="present-comb" aria-hidden="true">${T.spine({ ticks: [], form: 'comb', ariaLabel: 'The last 240 blocks, newest at the right' }).replace('data-spine ', 'data-spine-comb ')}</div>`;
}

/** The margin Spine's frame: the browser fills its hundred ticks from the head bus. */
function spineFrame() {
  return T.spine({ ticks: [], form: 'margin', ariaLabel: 'The last hundred blocks, newest on top' });
}

/**
 * The first screen. Left: the page's name, one sentence, four Readings at
 * figure-xl, the last hour's row at figure-m. Right: the agent activity panel
 * with the network graph behind its switch. The margin Spine runs down the left.
 */
function hero() {
  return `<header class="hero" data-instrument="hero" data-present-screen aria-labelledby="hero-h">
  <div class="nw-frame hero-grid">
    <aside class="hero-spine">${spineFrame()}</aside>
    <div class="hero-text">
      <h1 class="nw-display" id="hero-h">Observatory</h1>
      <p class="nw-body dek">${DEK}</p>
      <div class="hero-figures nw-stack">
${nwReading({ key: 'heroHeight', label: 'Height', size: 'xl' })}
${nwReading({ key: 'agents', label: 'Agents registered', size: 'xl' })}
${nwReading({ key: 'operatorRun', label: 'Operator-run', size: 'm', className: 'hero-sub' })}
          <p class="hero-note nw-small nw-dim" id="operator-note">${escapeHtml(OPERATOR_NOTE)}</p>
${nwReading({ key: 'activeAgreements', label: 'Agreements open', size: 'xl' })}
${nwReading({ key: 'messagesSent', label: 'Messages sent', size: 'xl', minSpec: 309 })}
      </div>
      <section class="hour" aria-labelledby="hour-h">
        <h2 class="nw-label hour-title" id="hour-h">Activity in the last hour</h2>
        <p class="hour-note nw-small nw-dim" hidden></p>
        <div class="readings nw-row hour-figures">
${nwReading({ key: 'hourOracle', label: 'Oracle answers' })}
${nwReading({ key: 'hourSettled', label: 'Agreements settled' })}
${nwReading({ key: 'hourDisputes', label: 'Disputes opened', className: 'is-dispute' })}
${nwReading({ key: 'hourSlashes', label: 'Slashes', className: 'is-slashed' })}
${nwReading({ key: 'hourMessages', label: 'Messages sent', minSpec: 309 })}
        </div>
      </section>
    </div>
    <figure class="panel hero-panel instrument" aria-labelledby="panel-h">
      <figcaption class="panel-head">
        <h2 class="nw-label panel-title" id="panel-h">Agent activity</h2>
        <button type="button" class="nw-quiet graph-toggle" role="switch" aria-checked="false">Network graph</button>
      </figcaption>
      <ul class="legend field-legend" aria-label="Ember marks">
        <li class="nw-tag" data-state="live"><span class="nw-dot" aria-hidden="true"></span>Heartbeat multiplier</li>
        <li class="nw-tag" data-state="dispute"><span class="nw-dot" aria-hidden="true"></span>In dispute</li>
        <li class="nw-tag" data-state="slashed"><span class="nw-dot" aria-hidden="true"></span>Slashed, last hour</li>
        <li class="nw-tag" data-state="operator"><span class="nw-dot" aria-hidden="true"></span>Operator-run</li>
        <li class="nw-tag" data-state="record"><span class="nw-dot" aria-hidden="true"></span>Unstaking</li>
      </ul>
      <ul class="legend graph-legend" aria-label="Line marks">
        <li class="nw-tag" data-state="live"><span class="nw-dot" aria-hidden="true"></span>Open</li>
        <li class="nw-tag" data-state="dispute"><span class="nw-dot" aria-hidden="true"></span>Disputed</li>
        <li class="nw-tag" data-state="settled"><span class="nw-dot" aria-hidden="true"></span>Settled</li>
      </ul>
      <div class="field-host">
        <canvas class="field-canvas" role="img" aria-label="Agent activity: one ember per registered agent, as dark as its heartbeat multiplier"></canvas>
        <div class="tooltip field-tip nw-tag" role="tooltip" hidden></div>
      </div>
      <div class="graph-host">
        <div class="constellation-host">
          <canvas class="constellation-canvas" role="img" aria-label="Network graph of the most active agents and the agreements between them"></canvas>
          <div class="tooltip constellation-tip nw-tag" role="tooltip" hidden></div>
        </div>
        <ol class="graph-bundles nw-mono" aria-label="Pairs with more lines than the graph draws" hidden></ol>
      </div>
      <p class="field-live nw-receipt-line" role="status" aria-live="off">reading the agent list…</p>
      <p class="panel-foot field-foot nw-small nw-dim">One ember per agent. External agents come first, then operator-run, each in order of registration.</p>
      <p class="panel-foot graph-note nw-small nw-dim"></p>
      <details class="disclosure agents-list"><summary class="nw-quiet">The same agents as a list</summary>
        <ol class="agent-list nw-mono" aria-live="off"></ol>
        <div class="list-pager nw-pager nw-label" hidden>
          <button type="button" class="nw-quiet" data-step="prev">← previous</button>
          <span class="pager-status"></span>
          <button type="button" class="nw-quiet" data-step="next">next →</button>
        </div>
      </details>
    </figure>
  </div>
</header>
${riverStrip()}`;
}

/** The river, drawn once on the page: the titled strip under the first screen (section 01 keeps only its status line). */
function riverStrip() {
  return `<figure class="nw-frame river-strip" aria-labelledby="river-h">
  <figcaption><h2 class="nw-label" id="river-h">Blocks arriving now</h2></figcaption>
  <canvas class="hero-river" role="img" aria-label="River of recent blocks, newest at the right, each bar as tall as its transaction count, the newest final block marked"></canvas>
</figure>`;
}

/** The footer's facts, every one from chain-facts.json's provenance. */
export function footerFacts(facts) {
  const p = facts.provenance;
  return { genesisHash: p.genesisHash, specVersion: p.specVersion, nodeVersion: p.nodeVersion ?? null, builtAt: p.fetchedAt, block: p.readAtBlock };
}

/** The scripts-off state: the Band with the build time, and the build's block as its receipt. */
function noscriptBand(facts) {
  const p = facts.provenance;
  return `<noscript><div class="nw-frame">${T.band({
    text: `Scripts are off. Every figure on this page is from the build, ${T.utc(p.fetchedAt)}, and carries its source. Nothing will move.`,
    receipt: `${T.requestLine({ method: 'WS', url: p.rpc })} · fetched ${T.utc(p.fetchedAt)} · block ${T.formatInt(p.readAtBlock)}`,
  })}</div></noscript>`;
}

/**
 * The two heartbeat periods the EmberBank needs, from chain-facts.json's
 * runtime constants (read off the node at build time, with the spec they were
 * read at), and the block time that turns them into words.
 */
export function heartbeatRecord(facts) {
  const agents = facts.constants?.agents ?? {};
  const record = {
    grace: Number(agents.heartbeatGracePeriod),
    decay: Number(agents.heartbeatDecayPeriod),
    blockMs: Number(facts.constants?.babe?.expectedBlockTime),
    source: 'chain-facts.json',
    specVersion: facts.provenance.specVersion,
    readAtBlock: facts.provenance.readAtBlock,
  };
  for (const key of ['grace', 'decay', 'blockMs']) if (!Number.isFinite(record[key]) || record[key] <= 0) throw new Error(`chain-facts.json has no ${key} for the EmberBank`);
  return record;
}

const jsonScript = (id, value) => `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;

/** chain-facts.json, read when the caller passes no facts (the tests call renderObservatory without them). */
const readFacts = () => JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

/**
 * The whole page, as a string. `history` is runtime-history.json; `posture`
 * is public/posture.json; `status` is public/status.json; `css` is the
 * assembled stylesheet to inline (the chrome, then this page's rules);
 * `facts` is chain-facts.json, for the footer and the scripts-off band.
 */
export function renderObservatory({ history, posture, status, css = '', facts = null }) {
  const chainFacts = facts ?? readFacts();
  return `<!doctype html>
<html lang="en">
<head>
${T.head({ title: 'Observatory — Scalar Commons', description: DEK, css, scripts: ['observatory.js'] })}
</head>
<body>
<a class="skip nw-visually-hidden" href="#chain">Skip to the instruments</a>
${T.topBar({ current: 'observatory', present: true })}
${hero()}
${noscriptBand(chainFacts)}
<main>
${Object.keys(SECTIONS)
  .map((name) => renderSection(name, { history, posture, status }))
  .join('\n')}
</main>
${combFrame()}
${T.footer({ facts: footerFacts(chainFacts) })}
${T.palette()}
<p class="sr-status nw-visually-hidden" role="status" aria-live="polite"></p>
<script type="application/json" id="runtime-history">${JSON.stringify(history).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="security-posture">${JSON.stringify(posture).replace(/</g, '\\u003c')}</script>
${jsonScript('heartbeat-record', heartbeatRecord(chainFacts))}
</body>
</html>
`;
}

/** The section each instrument draws into, for the dev harness (the agent field draws into the first screen). */
const HARNESS_SECTION = { pulse: 'chain', era: 'economy', economy: 'economy', posture: 'verify' };

/** A page holding one instrument's section, for the dev harness. */
export function renderHarness(name, { history, posture, status, css = '', facts = null }) {
  const section = name === 'agent-field' || name === 'constellation' ? hero() : renderSection(HARNESS_SECTION[name] ?? name, { history, posture, status });
  // The river draws into the strip, so the chain's harness carries it.
  const body = name === 'pulse' ? `${riverStrip()}\n${section}` : section;
  return `<!doctype html>
<html lang="en">
<head>
${T.head({ title: `Harness — ${name}`, description: `Instrument harness for ${name}.`, css, scripts: ['observatory.js'] })}
</head>
<body>
<main class="harness">
${body}
</main>
<p class="sr-status nw-visually-hidden" role="status" aria-live="polite"></p>
<script type="application/json" id="runtime-history">${JSON.stringify(history).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="security-posture">${JSON.stringify(posture).replace(/</g, '\\u003c')}</script>
${jsonScript('heartbeat-record', heartbeatRecord(facts ?? readFacts()))}
</body>
</html>
`;
}
