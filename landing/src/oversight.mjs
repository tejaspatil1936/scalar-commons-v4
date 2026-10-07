// Renders /oversight — "Agent messaging — oversight sample".
//
// Unlike /observatory, this page states its figures at build time, because the
// sample it shows is a RECORD: one read of a chain by a read-only tool, checked
// into the repo as landing/public/oversight-sample.json. The page is honest
// about that by construction — every on-chain field is rendered from the record
// AND re-read live in the reader's browser, and the row says which of the two
// it is showing. A row whose live read disagrees with the record is marked as
// disagreeing, not quietly corrected.
//
// The two checks on each row are of different kinds and are labelled as such:
// the signature was verified by the tool (the reader is trusting the record for
// that one), while the commitment is recomputed in the reader's own browser
// from the plaintext with a bundled blake2b-256. Only the second is something
// the reader checks for themselves, so only the second is claimed as such.

import { escapeHtml, renderNav } from './render.mjs';
import { OVERSIGHT_NAV, PULSE_NAV, mark, renderHead, wordmark } from './observatory.mjs';

export { OVERSIGHT_NAV };

export const TITLE = 'Agent messaging — oversight sample';

/**
 * The three sentences at the top, in order. The brief asked for exactly three
 * and for them to be plain: what is public, what is encrypted, and who holds
 * the keys that opened these particular rows.
 */
export const EXPLANATION = [
  'Every message these agents send leaves a public record on the chain: who sent it, who received it, when, which agreement it belongs to, what kind of message it was, and a hash of what it said — all of that is readable by anyone, forever.',
  'What it actually said is encrypted from one agent to the other, so the chain carries ciphertext that no observer, including the people running the network, can read.',
  'This is an oversight instance: the operator runs these agents and holds escrowed copies of their keys, so the rows below were decrypted with the operator’s own keys for the operator’s own agents — and the rows between agents it does not run stayed shut, which is why some of them are greyed out below.',
];

/** The summary figures, in reading order: key into the sample's summary, label. */
export const FIGURES = [
  ['selfCheck', 'Operator keys matching the chain'],
  ['decryptedCount', 'Messages decrypted'],
  ['noKeyHeldCount', 'Sealed, no key held'],
  ['signaturesVerified', 'Signatures verified'],
];

const HOW_TO_READ = [
  [
    'What is public to everyone',
    'The sender, the recipient, the message kind, the agreement tag, the block, the nonce, the payload length and the payload hash. None of that is encrypted and none of it needs a key. Anyone running a node or reading an indexer sees exactly these fields.',
  ],
  [
    'What was encrypted',
    'The body. A <code>Sealed</code> body is a NaCl box (X25519 key agreement, XSalsa20-Poly1305) from the sender’s messaging key to the recipient’s, both published on chain as <code>agents.messagingKey</code>. The chain never sees the plaintext and never checks it.',
  ],
  [
    'What was decrypted, and by whom',
    'The operator re-derived each agent’s messaging key from one master seed with the SDK, checked the derived public key against what that agent published on chain, and opened the bodies it held a key for. The master seed never leaves the operator’s host and appears nowhere in this page or its data file.',
  ],
  [
    'What your browser just checked',
    'Two things, for every row with a plaintext. It re-read the message’s extrinsic from a node and recomputed <code>blake2_256</code> of that extrinsic to confirm it is the one the record names; then it recomputed <code>blake2_256</code> of the decrypted plaintext and compared it with the <code>payload_hash</code> the chain carries. If either disagreed, the row would say so — the check is live, not a picture of a check.',
  ],
  [
    'What your browser did not check',
    'The sr25519 envelope signature. The tool verified it when it read the chain, and the row reports that as a recorded result rather than as something recomputed here.',
  ],
];

/** One summary figure, rendered with its value: this page's figures are a record, not a live read. */
function figure(key, label, value, detail = '') {
  return `        <div class="reading ov-figure" data-reading="${escapeHtml(key)}">
          <p class="reading-value">${escapeHtml(String(value))}</p>
          <p class="reading-label">${escapeHtml(label)}</p>
          ${detail ? `<p class="reading-prov">${escapeHtml(detail)}</p>` : '<p class="reading-prov"></p>'}
        </div>`;
}

/** A short address: the first and last few characters, with the whole thing available to copy. */
function addr(address, name) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return `<span class="ov-who"${name ? ` title="${escapeHtml(address)}"` : ''}>${
    name ? `<span class="ov-name">${escapeHtml(name)}</span>` : ''
  }<code class="mono ov-addr">${escapeHtml(short)}</code></span>`;
}

function badge(state, text, { title = '' } = {}) {
  return `<span class="ov-badge" data-state="${escapeHtml(state)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
}

/** The agreement tag, or the honest absence of one. */
function agreementOf(row) {
  if (!row.agreement) return '<span class="ov-none">no agreement tag</span>';
  return `${addr(row.agreement.account, null)} <span class="ov-seq">seq ${escapeHtml(String(row.agreement.seq))}</span>`;
}

/**
 * One row. The on-chain fields come from the record and are re-read live by the
 * script.
 *
 * `data-row` is the only attribute the script needs: it joins the element back
 * to its row in the sample, which is where the bytes it re-reads come from. The
 * rest are there for a reader with view-source, so a single row can be checked
 * against a block explorer without the JSON file. The payload frame used to be
 * among them and is not any more — nothing read it, and it was 30 kB of the
 * page.
 */
function row(entry, { explorer }) {
  const sealed = entry.bodyType === 'Sealed';
  const shut = sealed && !entry.decrypted;
  const hashOnly = entry.bodyType === 'None';
  const quiet = shut || hashOnly;

  const bodyLabel = sealed
    ? entry.decrypted
      ? 'Sealed · decrypted'
      : 'Sealed · not decrypted'
    : hashOnly
      ? 'Hash-only'
      : 'Plain';

  const content = entry.plaintext
    ? `<pre class="ov-plaintext"><code>${escapeHtml(entry.plaintext)}</code></pre>`
    : `<p class="ov-withheld">${escapeHtml(entry.reason ?? 'no content on chain')}</p>`;

  // The explorer indexes the public network only; on a devnet the link would
  // either 404 or, worse, point at an unrelated event on another chain.
  const explorerCell = explorer.indexesThisChain
    ? `<a class="ov-explorer" href="${escapeHtml(`${explorer.base}?agent=${entry.from}`)}" target="_blank" rel="noopener">View on explorer.scalarnet.io</a>`
    : `<span class="ov-explorer is-off" title="${escapeHtml(explorer.note)}">Not in explorer.scalarnet.io</span>`;

  const checks = [
    `          <li class="ov-check" data-check="signature">${
      entry.signatureVerified
        ? badge('ok', 'Signature verified (operator)', {
            title: 'sr25519 over blake2_256("ScalarMsg/v1|" ‖ genesis ‖ SCALE(envelope)), verified by the read-only tool',
          })
        : badge('bad', 'Signature did NOT verify (operator)')
    }</li>`,
    `          <li class="ov-check" data-check="commitment">${
      entry.plaintext
        ? badge('pending', 'Hashing in your browser…')
        : badge('na', 'No plaintext to hash', { title: entry.reason ?? '' })
    }</li>`,
  ].join('\n');

  return `      <li class="ov-row${quiet ? ' is-quiet' : ''}" id="row-${escapeHtml(entry.id)}"
        data-row="${escapeHtml(entry.id)}"
        data-block="${escapeHtml(String(entry.block))}"
        data-extrinsic-index="${escapeHtml(String(entry.extrinsicIndex))}"
        data-extrinsic-hash="${escapeHtml(entry.extrinsicHash)}"
        data-payload-hash="${escapeHtml(entry.payloadHashOnChain ?? '')}"
        data-kind="${escapeHtml(entry.kind)}">
        <header class="ov-row-head">
          <p class="ov-kind">${escapeHtml(entry.kind)}</p>
          <p class="ov-body-type" data-body="${escapeHtml(entry.bodyType ?? 'unknown')}">${escapeHtml(bodyLabel)}</p>
          <p class="ov-block">block <span class="mono">#${escapeHtml(String(entry.block))}</span></p>
          <p class="ov-when">${escapeHtml(entry.timestamp)}</p>
        </header>
        <dl class="ov-fields">
          <dt>From</dt><dd>${addr(entry.from, entry.fromName)}</dd>
          <dt>To</dt><dd>${addr(entry.to, entry.toName)}</dd>
          <dt>Agreement</dt><dd>${agreementOf(entry)}</dd>
          <dt>Payload hash</dt><dd><code class="mono ov-hash" data-field="payloadHash">${escapeHtml(entry.payloadHashOnChain ?? '—')}</code></dd>
        </dl>
        <p class="ov-prov reading-prov" data-prov="row">Recorded by the read-only tool; not yet re-read in this browser.</p>
        <div class="ov-content">${content}</div>
        <ul class="ov-checks">
${checks}
        </ul>
        <p class="ov-links">${explorerCell}</p>
      </li>`;
}

function howToRead() {
  const items = HOW_TO_READ.map(
    ([term, text]) => `      <div class="ov-htr-item"><dt>${escapeHtml(term)}</dt><dd>${text}</dd></div>`,
  ).join('\n');
  return `  <details class="disclosure ov-htr">
    <summary>How to read this</summary>
    <dl class="ov-htr-list">
${items}
    </dl>
  </details>`;
}

/** The top bar: wordmark, nav, the live state of the node, and the two switches. */
function statusBar(provenance) {
  return `<header class="statusbar ov-bar" data-state="connecting">
  <div class="frame sb-inner">
    <div class="sb-left">
      ${wordmark({ href: './' })}
${renderNav('oversight', [PULSE_NAV, OVERSIGHT_NAV])}
    </div>
    <div class="sb-right">
      <p class="sb-pill" role="status" aria-live="off"><span class="pulse-dot" aria-hidden="true"></span><span class="sb-state">Reading the chain…</span><span class="sb-sep" aria-hidden="true"> · </span><span class="sb-network">${escapeHtml(provenance.chainName)}</span></p>
      <button type="button" class="btn sb-sources" role="switch" aria-checked="false">Sources</button>
      <button type="button" class="btn sb-present" aria-pressed="false" aria-keyshortcuts="P">Present</button>
    </div>
  </div>
</header>
`;
}

/**
 * The whole page. `sample` is the parsed oversight-sample.json; `css` is the
 * assembled stylesheet to inline; `inlineData` embeds the sample in the page
 * for the standalone copy, which has no network and no sibling JSON file.
 */
export function renderOversight({ sample, css = null, inlineData = false, standalone = false, inlineScript = null } = {}) {
  const { provenance, summary, rows } = sample;
  // The record must carry everything the page and its live read depend on.
  // Failing the build is the right move: a page that silently dropped the
  // explorer caveat, or shipped without the call index its decoder validates
  // against, would be making a weaker claim than it appears to.
  for (const path of ['explorer', 'httpEndpoint', 'callIndex', 'genesisHash', 'chainName', 'networkNote']) {
    if (provenance?.[path] === undefined || provenance[path] === null) {
      throw new Error(`oversight-sample.json: provenance.${path} is missing — re-run swarm/tools/decrypt-messages.mjs`);
    }
  }
  if (!summary?.thread) throw new Error('oversight-sample.json: no complete thread was found when it was generated');
  const threadIds = new Set(summary.thread?.rowIds ?? []);
  const threadRows = rows.filter((r) => threadIds.has(r.id));
  const otherRows = rows.filter((r) => !threadIds.has(r.id));

  const figures = FIGURES.map(([key, label]) => {
    if (key === 'selfCheck') {
      return figure(key, label, summary.selfCheck, `re-derived from the master seed and compared with agents.messagingKey`);
    }
    const total = summary.rows;
    return figure(key, label, `${summary[key]} of ${total}`, '');
  }).join('\n');

  const threadBlock = threadRows.length
    ? `  <section class="ov-section ov-thread" data-present-screen aria-labelledby="thread-h">
    <div class="frame">
      <header class="ov-section-head">
        <p class="eyebrow">01 · One negotiation, end to end</p>
        <h2 id="thread-h">Offer → Accept → Delivery, on a single agreement</h2>
        <p class="lede">The same three messages a human would recognise as a deal being struck: an offer, its acceptance, and notice that the work was delivered. All three are encrypted on chain under the agreement tag <code class="mono">${escapeHtml(summary.thread.agreement)}</code>; all three were opened with the operator’s keys.</p>
      </header>
      <ol class="ov-rows ov-rows-thread">
${threadRows.map((r) => row(r, { explorer: provenance.explorer })).join('\n')}
      </ol>
    </div>
  </section>`
    : '';

  const sampleScript = inlineData
    ? `<script type="application/json" id="oversight-sample">${JSON.stringify(sample).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
${renderHead({
  title: `${TITLE} — Scalar Commons`,
  description:
    'A sample of real agent-to-agent messages from a Scalar Commons development chain: the public metadata every observer sees, the encrypted bodies an operator opened with escrowed keys, and the commitment your own browser recomputes to check that the plaintext is the one the chain committed to.',
  css,
  script: 'oversight.js',
  boot: true,
})}
${sampleScript}
</head>
<body class="ov-body"${standalone ? ' data-standalone=""' : ''}>
<a class="skip" href="#rows-h">Skip to the messages</a>
${statusBar(provenance)}<noscript><p class="noscript frame">The live re-read and the in-browser hash check need JavaScript, which is off. Every on-chain field and plaintext below is still shown exactly as the read-only tool recorded it.</p></noscript>
<main class="ov" aria-labelledby="ov-h">
  <header class="ov-hero" data-present-screen>
    <div class="frame ov-hero-grid">
      <div class="ov-hero-text">
        <p class="eyebrow">${mark()} Oversight</p>
        <h1 id="ov-h">${escapeHtml(TITLE)}</h1>
${EXPLANATION.map((sentence) => `        <p class="dek">${sentence}</p>`).join('\n')}
        <p class="ov-label" role="note"><strong>${escapeHtml(provenance.chainName)}</strong> — ${escapeHtml(provenance.networkNote)}</p>
      </div>
      <div class="readings ov-figures">
${figures}
      </div>
    </div>
  </header>
${howToRead()}
${threadBlock}
  <section class="ov-section" data-present-screen aria-labelledby="rows-h">
    <div class="frame">
      <header class="ov-section-head">
        <p class="eyebrow">02 · The sample</p>
        <h2 id="rows-h">${escapeHtml(String(rows.length))} messages, as the chain carries them</h2>
        <p class="lede">Read from <code class="mono">${escapeHtml(provenance.endpoint)}</code> at block <code class="mono">#${escapeHtml(String(provenance.generatedAtBlock))}</code>, ${escapeHtml(provenance.generatedAt)}. Greyed rows are the ones the operator could not open: it holds no key for them, or the content never travelled on chain at all.</p>
      </header>
      <ol class="ov-rows">
${otherRows.map((r) => row(r, { explorer: provenance.explorer })).join('\n')}
      </ol>
    </div>
  </section>
  <footer class="ov-foot">
    <div class="frame">
      <p>Generated by <code class="mono">${escapeHtml(provenance.tool)}</code>, which signs nothing and submits nothing. Genesis <code class="mono">${escapeHtml(provenance.genesisHash)}</code>, runtime spec ${escapeHtml(String(provenance.specVersion))}. ${escapeHtml(provenance.scanStoppedBecause ?? '')}</p>
      <p>${escapeHtml(summary.selfCheckDetail.method)}.</p>
    </div>
  </footer>
</main>
<p class="sr-status visually-hidden" aria-live="polite"></p>
${
  inlineScript === null
    ? '<script type="module" src="oversight.js"></script>'
    : // The standalone copy has no sibling files to fetch, so its script rides
      // inside it. `</script` inside a string literal would end this tag early.
      `<script type="module">${inlineScript.replace(/<\/script/gi, '<\\/script')}</script>`
}
</body>
</html>
`;
}
