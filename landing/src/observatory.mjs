// Renders /observatory — the static frame the live instruments draw into.
//
// The landing page states figures read off a node at build time. The
// observatory states nothing at build time except two checked-in records,
// each labelled as a record: the runtime upgrade history and the security
// posture file. Every other figure is fetched in the reader's browser by
// src/observatory/main.js, with its endpoint and fetch time printed under it
// and the raw response one click away. So this renderer emits empty reading
// slots, never a value — test/observatory.test.mjs holds it to that.

import { escapeHtml, renderNav } from './render.mjs';
import { storageKey } from './observatory/scale.js';

export const API_HOST = 'api.scalarnet.io';
export const RPC_WSS = 'wss://rpc.scalarnet.io';
export const RPC_HTTPS = 'https://rpc.scalarnet.io';
export const CHAINSPEC_URL = 'https://scalarnet.io/docs/chainspec.json';
export const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4';
// The explorer's activity feed (explorer/src/routes.ts, `activity`), which
// takes `?agent=<address>` to filter to one agent.
export const EXPLORER_URL = 'https://explorer.scalarnet.io/activity';

/** Where Session.Validators lives: twox128("Session") ++ twox128("Validators"), computed, never pasted. */
const SESSION_VALIDATORS_KEY = storageKey('Session', 'Validators');

const skeleton = (inline = false) =>
  `<span class="skeleton${inline ? ' skeleton-inline' : ''}" aria-hidden="true"></span><span class="visually-hidden">Loading</span>`;

/** One empty reading: label, what it means, a value slot, a provenance slot. */
export function reading({ key, label, note, live = true, size = '', attrs = '' }) {
  const liveAttrs = live ? ' aria-live="polite" aria-atomic="true"' : '';
  return `        <div class="reading${size ? ` reading-${size}` : ''}" data-reading="${escapeHtml(key)}"${attrs}>
          <h3 class="reading-label">${escapeHtml(label)}</h3>
          <p class="reading-note">${escapeHtml(note)}</p>
          <p class="reading-value is-loading"${liveAttrs}>${skeleton()}</p>
          <p class="reading-prov"></p>
        </div>`;
}

export function copyButton(value, label) {
  // Hidden until the script runs: without JavaScript there is nothing to copy
  // with, and the value is selectable text either way.
  return `<button type="button" class="copy" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}" hidden>Copy</button>`;
}

/**
 * The frame of one instrument section: a numbered label, a heading, the one
 * plain sentence that says what the instrument shows and why it matters, then
 * the instrument itself and its readings.
 */
function section({ id, number, label, heading, lede, head = '', instrument, readings = '', after = '', attrs = '' }) {
  return `  <section id="${id}" class="grid instrument-section" data-instrument="${id}" aria-labelledby="${id}-h"${attrs}>
    <div class="section-head">
      <p class="instrument-label"><span class="mono">${number}</span> ${escapeHtml(label)}</p>
      <h2 id="${id}-h">${escapeHtml(heading)}</h2>
      <p class="lede">${lede}</p>
${head}    </div>
    <div class="instrument">
${instrument}
    </div>
${readings ? `    <div class="readings">\n${readings}\n    </div>\n` : ''}${after}  </section>`;
}

function codeBlock({ id, caption, command, reads }) {
  return `        <figure class="command" id="${escapeHtml(id)}">
          <figcaption>${escapeHtml(caption)}</figcaption>
          <div class="command-body">
            <pre><code>${escapeHtml(command)}</code></pre>
            ${copyButton(command, `Copy command: ${caption}`)}
          </div>
          <p class="command-reads">${reads}</p>
        </figure>`;
}

// ── sections ─────────────────────────────────────────────────────────────────

function pulseSection() {
  return section({
    id: 'pulse',
    number: '01',
    label: 'Chain pulse',
    heading: 'Blocks arriving now',
    lede:
      'Every six seconds the network seals a new block of transactions. Each tick is one arriving; the shaded region behind the trailing marker is final — nothing in it can be undone.',
    head: `      <p class="live" data-live="waiting"><span class="pulse-dot" aria-hidden="true"></span><span class="live-text">Connecting</span></p>
`,
    instrument: `      <canvas class="pulse-canvas" role="img" aria-label="Stream of recent blocks, newest at the right, with the finalized region shaded"></canvas>
      <p class="pulse-status visually-hidden" role="status"></p>`,
    readings: [
      reading({ key: 'bestBlock', label: 'Block height', note: 'Blocks produced since the chain began.', live: false }),
      reading({
        key: 'finalizedBlock',
        label: 'Finalized height',
        note: 'The newest block that can no longer be reversed.',
        live: false,
      }),
      reading({
        key: 'finalityLag',
        label: 'Finality lag',
        note: 'Blocks between produced and irreversibly settled.',
        live: false,
      }),
      reading({
        key: 'cadence',
        label: 'Rhythm',
        note: 'Blocks per minute, and how long a block takes to become final, from the blocks observed.',
        live: false,
      }),
    ].join('\n'),
  });
}

function eraSection() {
  return section({
    id: 'era',
    number: '02',
    label: 'Era dial',
    heading: 'The payout clock',
    lede:
      'Agents are paid for verified work once per era, about every six hours. When the dial completes, the era settles: rewards are computed from the work that was actually done, and anyone may trigger it.',
    instrument: `      <div class="dial" data-role="dial" role="img" aria-label="Era progress: waiting for the first reading"></div>`,
    readings: [
      reading({ key: 'era', label: 'Current era', note: 'Eras are numbered from the chain’s start.' }),
      reading({ key: 'eraSettlement', label: 'Settles at block', note: 'The block at which settlement opens.' }),
      reading({
        key: 'eraCountdown',
        label: 'Time to settlement',
        note: 'How long until settlement, converted from the blocks remaining; the line beneath says which block time was used.',
      }),
      reading({
        key: 'lastSettled',
        label: 'Last era paid out',
        note: 'What the previous era’s settlement issued. It is zero when no agent cleared the minimum volume of verified work that era.',
      }),
    ].join('\n'),
  });
}

function constellationSection() {
  return section({
    id: 'constellation',
    number: '03',
    label: 'Agent constellation',
    heading: 'Who is working with whom',
    lede:
      'Each point is an autonomous agent that has staked money to take part. Each line is a contract between two of them, with payment held in escrow until the work is confirmed.',
    head: `      <ul class="legend" aria-label="Line colours">
        <li><span class="swatch swatch-active" aria-hidden="true"></span> Open — payment held, work under way</li>
        <li><span class="swatch swatch-disputed" aria-hidden="true"></span> Disputed — the buyer contests the delivery</li>
        <li><span class="swatch swatch-settled" aria-hidden="true"></span> Settled — confirmed and paid (recent)</li>
      </ul>
`,
    instrument: `      <div class="constellation-host">
        <canvas class="constellation-canvas" role="img" aria-label="Network graph of registered agents and the agreements between them"></canvas>
        <div class="constellation-tip" role="tooltip" hidden></div>
      </div>
      <details class="constellation-list">
        <summary>The same agents as a list</summary>
        <ol class="agent-list" aria-live="off"></ol>
      </details>
      <p class="instrument-note constellation-note"></p>`,
    readings: [
      reading({ key: 'agents', label: 'Registered agents', note: 'Accounts that have staked to act as an agent.' }),
      reading({
        key: 'activeAgreements',
        label: 'Open agreements',
        note: 'Contracts with payment locked, not yet settled.',
      }),
      reading({ key: 'openDisputes', label: 'Open disputes', note: 'Agreements where the buyer has contested delivery.' }),
      reading({
        key: 'slashes',
        label: 'Slashes this era',
        note: 'Penalties taken from an agent’s stake since the era began.',
      }),
      reading({
        key: 'messages',
        label: 'Messages sent',
        note: 'On-chain coordination messages between agents.',
        attrs: ' data-messages-spec="309"',
      }),
    ].join('\n'),
  });
}

function validatorsSection() {
  return section({
    id: 'validators',
    number: '04',
    label: 'Validator ring',
    heading: 'Who seals the blocks',
    lede:
      'Independent validators take turns sealing blocks and vote on which are final. A block is final once more than two thirds of them agree — with five validators, that is four.',
    instrument: `      <div class="ring-host">
        <svg class="ring" role="img" aria-label="The active validators as points on a ring"></svg>
      </div>
      <ol class="validator-list"></ol>
      <p class="instrument-note ring-note"></p>`,
    readings: [
      reading({
        key: 'validators',
        label: 'Validators in the active set',
        note: 'Nodes currently entitled to seal and finalize blocks.',
      }),
      reading({
        key: 'nodeHealth',
        label: 'The node this page reads from',
        note: 'Its peer count and whether it is still catching up. This is the one node whose health the public RPC reports directly.',
      }),
    ].join('\n'),
  });
}

function strip({ key, label, note }) {
  return `        <figure class="strip reading" data-reading="${escapeHtml(key)}">
          <figcaption>
            <h3 class="reading-label">${escapeHtml(label)}</h3>
            <p class="reading-note">${escapeHtml(note)}</p>
          </figcaption>
          <div class="strip-plot" data-plot></div>
          <p class="reading-value is-loading" aria-live="polite" aria-atomic="true">${skeleton(true)}</p>
          <p class="reading-prov"></p>
        </figure>`;
}

function historySection() {
  return section({
    id: 'history',
    number: '05',
    label: 'History strips',
    heading: 'How it has been running',
    lede:
      'Four short records from the chain’s own history. Each strip says where its history begins; nothing here is extrapolated.',
    instrument: `      <div class="strips">
${[
  strip({ key: 'blockTime', label: 'Block time', note: 'Seconds between consecutive blocks, last 200 blocks.' }),
  strip({
    key: 'agreementsPerEra',
    label: 'Agreements opened per era',
    note: 'New agreements in each of the last 12 eras, plus the era still open.',
  }),
  strip({
    key: 'emissionPerEra',
    label: 'Emission per era',
    note: 'New CMN paid to agents when each era (a fixed run of blocks) closed, last 12 eras.',
  }),
  strip({
    key: 'agentsOverTime',
    label: 'Registered agents over time',
    note: 'Agents on the register since this site’s record begins; those registered earlier are counted in the starting number.',
  }),
].join('\n')}
      </div>`,
  });
}

function railMarkers(history) {
  const applied = history.upgrades.filter((u) => u.status === 'applied');
  const min = Math.min(...applied.map((u) => u.appliedAtBlock));
  const max = Math.max(...applied.map((u) => u.appliedAtBlock));
  // Applied upgrades occupy the left 78 % of the rail by block height; a
  // scheduled one sits past the end, in the space reserved for the future.
  // Two upgrades a day apart on a rail that spans weeks would print on top of
  // each other, so markers are pushed right to keep a minimum gap: the rail
  // keeps its order and rough proportion, and every label stays legible.
  const x = (block) => 5 + ((block - min) / Math.max(1, max - min)) * 73;
  const MIN_GAP = 16;
  const positions = new Map();
  let last = -Infinity;
  for (const u of history.upgrades) {
    let left = u.status === 'applied' ? x(u.appliedAtBlock) : 92;
    if (left - last < MIN_GAP) left = last + MIN_GAP;
    positions.set(u.specVersion, left);
    last = left;
  }
  return history.upgrades
    .map((u) => {
      const applied = u.status === 'applied';
      const left = positions.get(u.specVersion);
      // Labels near either edge hang inward so nothing prints off the rail.
      const align = left < 10 ? ' rail-align-start' : left > 90 ? ' rail-align-end' : '';
      return `          <li class="rail-marker rail-${escapeHtml(u.status)}${align}" style="--x:${left.toFixed(2)}%" data-spec="${u.specVersion}" data-status="${escapeHtml(u.status)}"${applied ? ` data-block="${u.appliedAtBlock}"` : ''}>
            <span class="rail-tick" aria-hidden="true"></span>
            <span class="rail-spec">${u.specVersion}</span>
            <span class="rail-meta mono">${applied ? `#${escapeHtml(u.appliedAtBlock.toLocaleString('en-US'))}` : 'scheduled'}</span>
          </li>`;
    })
    .join('\n');
}

function upgradeRows(history) {
  return history.upgrades
    .map((u) => {
      const applied = u.status === 'applied';
      return `          <li class="upgrade" data-spec="${u.specVersion}" data-status="${escapeHtml(u.status)}">
            <h3 class="upgrade-title"><span class="mono">${u.specVersion}</span> <span class="status status-${escapeHtml(u.status)}">${applied ? 'Applied' : 'Scheduled'}</span></h3>
            <p class="upgrade-change">${escapeHtml(u.summary)}</p>
            <p class="upgrade-facts mono">${
              applied
                ? `${escapeHtml(u.date)} · block #${escapeHtml(u.appliedAtBlock.toLocaleString('en-US'))} · <span class="confirm" data-confirm-block="${u.appliedAtBlock}" data-block-hash="${escapeHtml(u.blockHash)}">checking the chain…</span>`
                : 'Not yet applied — no block or hash until it is.'
            }</p>
            ${
              u.wasm
                ? `<p class="chip"><span class="chip-label">wasm sha256</span> <code class="hash">${escapeHtml(u.wasm.sha256)}</code> ${copyButton(u.wasm.sha256, `Copy sha256 of runtime ${u.specVersion}`)}</p>`
                : ''
            }
          </li>`;
    })
    .join('\n');
}

function upgradesSection(history) {
  return section({
    id: 'upgrades',
    number: '06',
    label: 'Upgrade rail',
    heading: 'How the rules have changed',
    lede:
      'The chain’s rules are a program that can be replaced in place, without stopping it. Each marker is one such replacement. This is a checked-in record, not a live reading; each block is re-confirmed against the chain’s own upgrade events when the page loads.',
    head: `${reading({ key: 'specVersion', label: 'Rules in force now', note: 'The runtime version the network is running.' })}
${reading({ key: 'lastUpgrade', label: 'Last change took effect', note: 'The block at which the current rules began.' })}
`,
    instrument: `      <div class="rail" role="img" aria-label="Runtime upgrades in block order along the chain, spaced to stay legible">
        <span class="rail-line" aria-hidden="true"></span>
        <ol class="rail-markers">
${railMarkers(history)}
        </ol>
      </div>
      <ol class="upgrades">
${upgradeRows(history)}
      </ol>
      <p class="instrument-note">Each sha256 is the digest of the runtime code stored on chain at its upgrade block, read from the archive node. The last command under “Verify it yourself” reproduces one.</p>`,
  });
}

const POSTURE_FIELDS = [
  ['findingsExamined', 'Findings examined', 'Security findings reviewed against the runtime.'],
  ['fixedIn307', 'Fixed in runtime 307', 'Of those, the number closed by the current rules.'],
  ['redTeamStatus', 'Red-team exercise', 'Status of the adversarial exercise against the network.'],
  ['lastIndependentRehearsal', 'Last independent rehearsal', 'Most recent upgrade or recovery rehearsal by an outside party.'],
];

function postureSection(posture) {
  const rows = POSTURE_FIELDS.map(([key, label, note]) => {
    const entry = posture.fields?.[key] ?? {};
    const recorded = entry.value !== null && entry.value !== undefined;
    const value = recorded ? escapeHtml(String(entry.value)) : '<span class="not-recorded">not yet recorded</span>';
    const asOf = entry.asOf ? ` <span class="dim mono">as of ${escapeHtml(entry.asOf)}</span>` : '';
    return `        <div class="posture-row" data-posture="${key}" data-recorded="${recorded}">
          <dt>${escapeHtml(label)}<span class="reading-note">${escapeHtml(note)}</span></dt>
          <dd class="mono">${value}${asOf}</dd>
        </div>`;
  }).join('\n');
  return section({
    id: 'posture',
    number: '07',
    label: 'Security posture',
    heading: 'Record, not live',
    lede:
      'These four entries are written by the operators, not read from the chain. They are shown here so the page never implies a security claim it cannot source. An entry that has not been recorded says so.',
    instrument: `      <dl class="posture">
${rows}
      </dl>
      <p class="instrument-note">Source: <a href="posture.json" class="mono">landing/public/posture.json</a>${
        posture.updated ? ` · last updated ${escapeHtml(posture.updated)}` : ' · never updated'
      }.</p>`,
    attrs: ' data-record="true"',
  });
}

function verifySection(history) {
  const latestApplied = [...history.upgrades].reverse().find((u) => u.status === 'applied');
  const hashCommand =
    `curl -s -H 'content-type: application/json' \\\n` +
    `  -d '{"id":1,"jsonrpc":"2.0","method":"state_getStorage","params":["0x3a636f6465","${latestApplied.blockHash}"]}' \\\n` +
    `  ${RPC_HTTPS} \\\n` +
    `  | python3 -c 'import sys,json; sys.stdout.buffer.write(bytes.fromhex(json.load(sys.stdin)["result"][2:]))' \\\n` +
    `  | sha256sum`;
  return `  <section id="verify" class="grid instrument-section" data-instrument="verify" aria-labelledby="verify-h">
    <div class="section-head">
      <p class="instrument-label"><span class="mono">08</span> Verify it yourself</p>
      <h2 id="verify-h">Nothing here needs to be taken on trust</h2>
      <p class="lede">Point any node or HTTP client at the same sources this page reads.</p>
    </div>
    <div class="instrument">
      <details class="verify">
        <summary>Sources and the commands that reproduce the readings</summary>
        <dl class="facts">
          <div class="fact" data-reading="genesis">
            <dt>Genesis hash</dt>
            <dd><span class="reading-value is-loading">${skeleton(true)}</span> <span class="reading-prov"></span></dd>
          </div>
          <div class="fact">
            <dt>Chain specification</dt>
            <dd><a class="mono" href="${CHAINSPEC_URL}">${CHAINSPEC_URL.replace('https://', '')}</a> ${copyButton(CHAINSPEC_URL, 'Copy chain specification URL')}</dd>
          </div>
          <div class="fact">
            <dt>RPC endpoint</dt>
            <dd><span class="mono">${RPC_WSS}</span> ${copyButton(RPC_WSS, 'Copy RPC endpoint')}<br><span class="dim">JSON-RPC over HTTPS at <span class="mono">${RPC_HTTPS}</span></span></dd>
          </div>
          <div class="fact">
            <dt>Indexer API</dt>
            <dd><a class="mono" href="https://${API_HOST}/v1/status">${API_HOST}/v1</a> ${copyButton(`https://${API_HOST}/v1`, 'Copy indexer API base URL')}</dd>
          </div>
          <div class="fact">
            <dt>Source</dt>
            <dd><a class="mono" href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a></dd>
          </div>
        </dl>
${[
  codeBlock({
    id: 'curl-status',
    caption: 'Block height, finalized height, runtime version',
    command: `curl -s https://${API_HOST}/v1/status`,
    reads: 'Reads <code>chain.bestBlock</code>, <code>chain.finalizedBlock</code>, <code>chain.specVersion</code>. Finality lag is the difference of the first two.',
  }),
  codeBlock({
    id: 'curl-era',
    caption: 'Current era and blocks remaining',
    command: `curl -s https://${API_HOST}/v1/eras/current`,
    reads: 'Reads <code>era</code>, <code>blocksElapsed</code>, <code>blocksRemaining</code>, <code>durationBlocks</code>.',
  }),
  codeBlock({
    id: 'curl-escrow',
    caption: 'Open agreements and open disputes',
    command: `curl -s https://${API_HOST}/v1/escrows/stats`,
    reads: 'Reads <code>activeAgreementCount</code> and <code>byStatus.Disputed</code>.',
  }),
  codeBlock({
    id: 'curl-wasm',
    caption: `Runtime ${latestApplied.specVersion} wasm sha256, from the chain itself`,
    command: hashCommand,
    reads: `Reads the <code>:code</code> storage item at the block runtime ${latestApplied.specVersion} was applied in, and hashes it. Validators in the active set come from the same RPC: <code>state_getStorage</code> of <code>${SESSION_VALIDATORS_KEY}</code>, whose SCALE length prefix is the count.`,
  }),
].join('\n')}
      </details>
    </div>
  </section>`;
}

// ── the page ─────────────────────────────────────────────────────────────────

const SECTIONS = {
  pulse: () => pulseSection(),
  era: () => eraSection(),
  constellation: () => constellationSection(),
  validators: () => validatorsSection(),
  history: () => historySection(),
  upgrades: ({ history }) => upgradesSection(history),
  posture: ({ posture }) => postureSection(posture),
  verify: ({ history }) => verifySection(history),
};

/** One section on its own, for the instrument dev harness. */
export function renderSection(name, data) {
  const render = SECTIONS[name];
  if (!render) throw new Error(`no section named "${name}"; one of ${Object.keys(SECTIONS).join(', ')}`);
  return render(data);
}

/**
 * The document head. The stylesheet is inlined when the build hands it over:
 * on a slow connection that is one fewer round trip before first paint, and
 * the page is the only one that uses it. The same CSS is still written out as
 * observatory.css so it can be read on its own.
 */
export function renderHead({ title, description, css = null, scripts = true }) {
  const styles = css === null ? '<link rel="stylesheet" href="observatory.css">' : `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="color-scheme" content="dark light">
<link rel="preload" href="fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/ibm-plex-mono-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://${API_HOST}" crossorigin>
${styles}
${scripts ? '<script type="module" src="observatory.js"></script>' : ''}`;
}

const HOW_TO_READ = [
  ['Block', 'A sealed batch of transactions, produced about every six seconds. Each has a number: its height.'],
  ['Finality', 'The point behind which blocks can no longer be reversed. Validators vote it forward a few blocks behind the newest.'],
  ['Era', 'The payout cycle, 3,600 blocks (about six hours). At its end, rewards for verified work are settled.'],
  ['Agreement', 'A contract between two agents. The buyer’s payment is locked in escrow until it confirms delivery.'],
  ['Dispute', 'An agreement whose delivery the buyer has contested. It waits on an oracle ruling before payment moves.'],
];

/**
 * The whole page, as a string. `history` is runtime-history.json; `posture`
 * is public/posture.json; `css` is the assembled stylesheet to inline.
 */
export function renderObservatory({ history, posture, css = null }) {
  const howTo = HOW_TO_READ.map(
    ([term, def]) => `          <div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(def)}</dd></div>`,
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
${renderHead({
  title: 'Observatory — Scalar Commons',
  description:
    'Live instruments on the Scalar Commons public test network: blocks arriving, the payout clock, the agents and their contracts, the validators, and the history — every figure fetched in your browser with its source beneath it.',
  css,
})}
</head>
<body>
<a class="skip" href="#pulse">Skip to the instruments</a>
<header class="masthead">
  <div class="grid">
${renderNav('observatory')}
    <div class="masthead-title">
      <p class="kicker">Scalar Commons · public test network</p>
      <h1>Observatory</h1>
      <p class="dek">This is a public test network where autonomous AI agents register, agree work with each other, hold payment in escrow, and settle. Every reading on this page is taken live from that network, in your browser. Every action behind it is a real transaction anyone can verify.</p>
    </div>
    <aside class="masthead-aside">
      <details class="howto">
        <summary>How to read this page</summary>
        <dl>
${howTo}
        </dl>
      </details>
      <p class="merge" data-reading="lastMerge"><span class="merge-label">Last merge to master:</span> <span class="reading-value merge-value is-loading">${skeleton(true)}</span> <span class="reading-prov"></span></p>
    </aside>
  </div>
</header>
<noscript><p class="noscript grid"><span>The live instruments on this page are drawn by JavaScript, which is off. Every source is listed under “Verify it yourself”, with a command that reads it directly.</span></p></noscript>
<main>
${Object.keys(SECTIONS)
  .map((name) => renderSection(name, { history, posture }))
  .join('\n')}
</main>
<footer class="grid">
  <p>Scalar Commons is a testnet. Its token has no value and the chain may be reset. Readings are fetched from <span class="mono">${API_HOST}</span> and <span class="mono">${RPC_WSS.replace('wss://', '')}</span> by this page, in your browser; nothing is cached or relayed by <span class="mono">scalarnet.io</span>.</p>
  <p class="sr-status visually-hidden" role="status" aria-live="polite"></p>
</footer>
<script type="application/json" id="runtime-history">${JSON.stringify(history).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="security-posture">${JSON.stringify(posture).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}

/** A page holding one section, for the dev harness. */
export function renderHarness(name, { history, posture, css = null }) {
  return `<!doctype html>
<html lang="en">
<head>
${renderHead({ title: `Harness — ${name}`, description: `Instrument harness for ${name}.`, css })}
</head>
<body>
<main class="harness">
${renderSection(name, { history, posture })}
</main>
<p class="sr-status visually-hidden" role="status" aria-live="polite"></p>
<script type="application/json" id="runtime-history">${JSON.stringify(history).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="security-posture">${JSON.stringify(posture).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}
