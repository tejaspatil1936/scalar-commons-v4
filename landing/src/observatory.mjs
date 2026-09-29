// Renders /observatory — the static frame the live readings are fetched into.
//
// The landing page states figures read off a node at build time. The
// observatory is the other half of that promise: it states nothing at build
// time except the checked-in upgrade record, and fetches every live figure in
// the reader's own browser, with the endpoint and fetch time printed under it
// and the raw response one click away. So this renderer emits empty reading
// slots, never a value — test/observatory.test.mjs holds it to that.

import { escapeHtml, renderNav } from './render.mjs';

const API_HOST = 'api.scalarnet.io';
const RPC_WSS = 'wss://rpc.scalarnet.io';
const RPC_HTTPS = 'https://rpc.scalarnet.io';
const CHAINSPEC_URL = 'https://scalarnet.io/docs/chainspec.json';
const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4';
// explorer.scalarnet.io/activity is the requested destination, but the
// explorer has no such route today (explorer/src/routes.ts serves /, /block,
// /extrinsic and /account; /activity answers 404). Link what exists.
const EXPLORER_URL = 'https://explorer.scalarnet.io/';

// Storage key of Session.Validators: twox128("Session") ++ twox128("Validators").
const SESSION_VALIDATORS_KEY = '0xcec5070d609dd3497f72bde07fc96ba088dcde934c658227ee1dfafcd6e16903';

/** One empty reading: label, what it means, a value slot, a provenance slot. */
function reading({ key, label, note, wide = false, extra = '', attrs = '' }) {
  return `        <div class="reading${wide ? ' reading-wide' : ''}" data-reading="${escapeHtml(key)}"${attrs}>
          <h3 class="reading-label">${escapeHtml(label)}</h3>
          <p class="reading-note">${escapeHtml(note)}</p>
          <p class="reading-value is-loading"><span class="skeleton" aria-hidden="true"></span><span class="visually-hidden">Loading</span></p>
${extra}          <p class="reading-prov"></p>
        </div>`;
}

function copyButton(value, label) {
  // Hidden until the script runs: without JavaScript there is nothing to copy
  // with, and the value is selectable text either way.
  return `<button type="button" class="copy" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}" hidden>Copy</button>`;
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

function historyRows(history) {
  return history.upgrades
    .map((u) => {
      const applied = u.status === 'applied';
      const status = applied ? 'Applied' : 'Scheduled';
      const block = applied
        ? `<span class="mono">#${escapeHtml(u.appliedAtBlock.toLocaleString('en-US'))}</span>
              <span class="confirm" data-confirm-block="${u.appliedAtBlock}"></span>`
        : '<span class="dim">Not yet applied</span>';
      const hash = u.wasm
        ? `<code class="hash">${escapeHtml(u.wasm.sha256)}</code>
              ${copyButton(u.wasm.sha256, `Copy sha256 of runtime ${u.specVersion}`)}`
        : '<span class="dim">Published when applied</span>';
      const cell = (label, html, tag = 'td', attrs = '') =>
        `<${tag}${attrs} data-label="${label}"><div class="cell">${html}</div></${tag}>`;
      return `            <tr data-spec="${u.specVersion}" data-status="${escapeHtml(u.status)}">
              ${cell('Runtime', `<span class="mono">${u.specVersion}</span>`, 'th', ' scope="row"')}
              ${cell('Status', `<span class="status status-${escapeHtml(u.status)}">${status}</span>`)}
              ${cell('Date (UTC)', `<span class="mono">${applied ? escapeHtml(u.date) : '—'}</span>`)}
              ${cell('Block', block)}
              ${cell('Change', escapeHtml(u.summary))}
              ${cell('Wasm sha256', hash)}
            </tr>`;
    })
    .join('\n');
}

/** The whole page, as a string. `history` is runtime-history.json. */
export function renderObservatory({ history }) {
  const messagesSpec = history.upgrades.find((u) => (u.introduces ?? []).includes('messages'))?.specVersion;
  const latestApplied = [...history.upgrades].reverse().find((u) => u.status === 'applied');

  const hashCommand =
    `curl -s -H 'content-type: application/json' \\\n` +
    `  -d '{"id":1,"jsonrpc":"2.0","method":"state_getStorage","params":["0x3a636f6465","${latestApplied.blockHash}"]}' \\\n` +
    `  ${RPC_HTTPS} \\\n` +
    `  | python3 -c 'import sys,json; sys.stdout.buffer.write(bytes.fromhex(json.load(sys.stdin)["result"][2:]))' \\\n` +
    `  | sha256sum`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Observatory — Scalar Commons</title>
<meta name="description" content="Live readings from the Scalar Commons public testnet. Every figure names the endpoint it came from and links to the raw response.">
<meta name="color-scheme" content="light dark">
<link rel="preconnect" href="https://${API_HOST}" crossorigin>
<link rel="stylesheet" href="observatory.css">
<script type="module" src="observatory.js"></script>
</head>
<body>
<a class="skip" href="#chain">Skip to readings</a>
<header class="masthead">
  <div class="grid">
${renderNav('observatory')}
    <div class="masthead-title">
      <p class="kicker">Scalar Commons · public testnet</p>
      <h1>Observatory</h1>
      <p class="dek">Live readings from the chain, taken in your browser. Under every figure is the endpoint it came from and the time it was fetched; select the figure to open the raw response. If a reading cannot be taken, it says so.</p>
      <p class="merge" data-reading="lastMerge"><span class="merge-label">Last merge to master:</span> <span class="reading-value merge-value is-loading"><span class="skeleton skeleton-inline" aria-hidden="true"></span><span class="visually-hidden">Loading</span></span> <span class="reading-prov"></span></p>
    </div>
  </div>
</header>
<noscript><p class="noscript">The live readings on this page are fetched by JavaScript, which is off. Every source is listed under “Verify it yourself”, with a command that reads it directly.</p></noscript>
<main>
  <section id="chain" class="grid" aria-labelledby="chain-h">
    <div class="section-head">
      <h2 id="chain-h">Chain</h2>
      <p class="live" data-live="waiting"><span class="pulse" aria-hidden="true"></span><span class="live-text">Connecting</span></p>
      <p class="section-note">Refreshed every six seconds, roughly once per block; the validator set and last upgrade every minute. Paused while this tab is hidden.</p>
    </div>
    <div class="readings">
${[
  reading({ key: 'bestBlock', label: 'Block height', note: 'Blocks produced since the chain began.' }),
  reading({ key: 'finalizedBlock', label: 'Finalized height', note: 'The newest block that can no longer be reversed.' }),
  reading({ key: 'finalityLag', label: 'Finality lag', note: 'Blocks between produced and irreversibly settled.' }),
  reading({
    key: 'validators',
    label: 'Validators in the active set',
    note: 'Nodes currently entitled to produce and finalize blocks.',
  }),
  reading({ key: 'specVersion', label: 'Runtime version', note: 'The version of the chain’s rules now in force.' }),
  reading({
    key: 'lastUpgrade',
    label: 'Last runtime upgrade',
    note: 'The block at which the rules in force took effect.',
  }),
  reading({
    key: 'era',
    label: 'Current era',
    note: 'Rewards are settled once per era. When an era ends, anyone may trigger its settlement.',
    wide: true,
    extra: `          <p class="era-bar" role="progressbar" aria-label="Progress through the current era" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><span class="era-fill"></span></p>
          <p class="era-detail"></p>
`,
  }),
].join('\n')}
    </div>
  </section>

  <section id="agents" class="grid" aria-labelledby="agents-h">
    <div class="section-head">
      <h2 id="agents-h">Agents</h2>
      <p class="section-note">Refreshed every thirty seconds. Agreement and dispute figures are read from live chain state; slashes from the finalized-block index.</p>
      <p class="section-link"><a href="${EXPLORER_URL}">Browse activity in the explorer</a></p>
    </div>
    <div class="readings">
${[
  reading({ key: 'agents', label: 'Registered agents', note: 'Accounts that have staked to act as an agent.' }),
  reading({
    key: 'activeAgreements',
    label: 'Active agreements',
    note: 'Escrowed contracts between agents, funds locked, not yet settled.',
  }),
  reading({
    key: 'openDisputes',
    label: 'Open disputes',
    note: 'Agreements where the buyer has contested the delivery.',
  }),
  reading({
    key: 'slashes',
    label: 'Slashes this era',
    note: 'Penalties executed against an agent’s stake since the era began.',
  }),
  reading({
    key: 'messages',
    label: 'Messages sent',
    note: 'On-chain coordination messages between agents.',
    attrs: messagesSpec ? ` data-messages-spec="${messagesSpec}"` : '',
  }),
].join('\n')}
    </div>
  </section>

  <section id="history" class="grid" aria-labelledby="history-h">
    <div class="section-head">
      <h2 id="history-h">Runtime history</h2>
      <p class="section-note">Upgrades applied to the running chain without a restart. This table is a checked-in record, not a live reading; each block is re-confirmed against the chain’s own upgrade events when the page loads.</p>
    </div>
    <div class="section-body">
      <table class="history">
        <caption class="visually-hidden">Runtime upgrades, oldest first</caption>
        <thead>
          <tr><th scope="col">Runtime</th><th scope="col">Status</th><th scope="col">Date (UTC)</th><th scope="col">Block</th><th scope="col">Change</th><th scope="col">Wasm sha256</th></tr>
        </thead>
        <tbody>
${historyRows(history)}
        </tbody>
      </table>
      <p class="table-note">Each sha256 is the digest of the runtime code stored on chain at its upgrade block, read from the archive node. The commands under “Verify it yourself” reproduce one.</p>
    </div>
  </section>

  <section id="verify" class="grid" aria-labelledby="verify-h">
    <div class="section-head">
      <h2 id="verify-h">Verify it yourself</h2>
      <p class="section-note">Nothing on this page needs to be taken on trust. Point any node or HTTP client at the same sources.</p>
    </div>
    <div class="section-body">
      <dl class="facts">
        <div class="fact" data-reading="genesis">
          <dt>Genesis hash</dt>
          <dd><span class="reading-value is-loading"><span class="skeleton skeleton-inline" aria-hidden="true"></span><span class="visually-hidden">Loading</span></span> <span class="reading-prov"></span></dd>
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
    caption: 'Active agreements and open disputes',
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
    </div>
  </section>
</main>
<footer class="grid">
  <p>Scalar Commons is a testnet. Its token has no value and the chain may be reset. Readings are fetched from <span class="mono">${API_HOST}</span> and <span class="mono">${RPC_HTTPS.replace('https://', '')}</span> by this page, in your browser; nothing is cached or relayed by <span class="mono">scalarnet.io</span>.</p>
  <p class="sr-status visually-hidden" role="status" aria-live="polite"></p>
</footer>
</body>
</html>
`;
}
