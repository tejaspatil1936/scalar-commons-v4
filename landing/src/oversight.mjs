// Renders /oversight — "What an operator can and cannot read" (brief §5.7).
//
// Unlike /observatory, this page states its figures at build time, because the
// sample it shows is a RECORD: one read of a chain by a read-only tool, checked
// into the repo as landing/public/oversight-sample.json. The page is honest
// about that by construction — every on-chain field is rendered from the record
// AND re-read live in the reader's browser, and the row says which of the two
// it is showing. A row whose live read disagrees with the record is marked as
// disagreeing — a dotted ink rule down its left edge and the word, never a
// colour (SITE-ROUND2.md §1.2) — not quietly corrected.
//
// The two checks on each row are of different kinds and are labelled as such:
// the signature was verified by the tool (a record stub, a rule-2 outline on
// paper: the reader is trusting the record for that one), while the
// commitment is recomputed in the reader's own browser from the plaintext with
// a bundled blake2b-256 (a live stub, solid ink). Only the second is something
// the reader checks for themselves.
//
// Drawn on the chrome (src/chrome): head(), topBar(), footer(), Readings,
// Tags, Redactions, leaders and the Ledger; this file adds no colour or size.

import { PULSE_NAV } from './observatory.mjs';
import { escapeHtml, footer, formatInt, head, leader, ledger, reading, redaction, tag, topBar } from './chrome-legacy/templates.mjs';

export { PULSE_NAV };
/** The nav entry for this page (the branch read it from observatory.mjs, which this checkout does not carry). */
export const OVERSIGHT_NAV = { key: 'oversight', label: 'Oversight', href: 'oversight' };

export const TITLE = 'What an operator can and cannot read';
export const HEADLINE = TITLE;
export const STANDFIRST =
  'Forty real messages from a development chain, decrypted by the operator with the keys it holds. This page signs nothing and submits nothing.';

/**
 * The three sentences, in order, under the standfirst. The original brief asked
 * for exactly three and for them to be plain: what is public, what is encrypted,
 * and who holds the keys that opened these particular rows.
 */
export const EXPLANATION = [
  'Every message these agents send leaves a public record on the chain: who sent it, who received it, when, which agreement it belongs to, what kind of message it was, and a hash of what it said — all of that is readable by anyone, forever.',
  'What it actually said is encrypted from one agent to the other, so the chain carries ciphertext that no observer, including the people running the network, can read.',
  'This is an oversight instance: the operator runs these agents and holds escrowed copies of their keys, so every encrypted row below that belongs to one of its own agents was opened with the operator’s own keys — rows between agents it does not run stayed shut and are greyed out, and a few rows were never encrypted in the first place.',
];

/** The recorded summary figures, in reading order: key into the sample's summary, label. All four are the tool's (record stubs: outline, not fill). */
export const FIGURES = [
  ['selfCheck', 'Operator keys matching the chain'],
  ['decryptedCount', 'Decrypted by the operator'],
  ['noKeyHeldCount', 'Sealed, no key held'],
  ['signaturesVerified', 'Signatures verified'],
];
/** The fifth figure is the reader's own: filled by the browser after it has hashed every plaintext. */
export const RECHECK = ['rechecked', 'Re-checked in your browser'];

/** HOW TO READ THIS — five rows, verbatim from the brief. */
export const HOW_TO_READ = [
  ['Public to everyone', 'sender, recipient, kind, agreement tag, block, nonce, payload length, payload hash'],
  ['Encrypted', 'the body, a NaCl box to the recipient’s published key'],
  ['Decrypted, by whom', 'the bodies the operator decrypted with its own escrowed keys, for its own agents only'],
  ['Re-checked by your browser', 'the plaintext’s blake2b-256 against the chain’s commitment'],
  ['Not checked here', 'signatures, verified by the operator’s tool'],
];

export const LEDGER_ROWS = 6;
export const DISAGREE_WORD = 'DISAGREES WITH THE RECORD';

const short = (s) => `${String(s).slice(0, 6)}…${String(s).slice(-4)}`;

/** A party: the agent's name from the record (operator-run when it carries the swarm prefix) and its short address. */
function who(addr, name) {
  const operator = typeof name === 'string' && name.startsWith('swarm-');
  return `<span class="ov-who" title="${escapeHtml(addr)}">${
    name ? `<span class="nw-agent${operator ? ' is-operator' : ''}">${escapeHtml(name)}</span> ` : ''
  }<code class="nw-mono ov-addr">${escapeHtml(short(addr))}</code></span>`;
}

function badge(state, text, { title = '' } = {}) {
  return `<span class="ov-badge nw-label" data-state="${escapeHtml(state)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
}

/** The agreement tag, or the honest absence of one. */
function agreementOf(row) {
  if (!row.agreement) return '<span class="ov-none nw-sage">no agreement tag</span>';
  return `${who(row.agreement.account, null)} <span class="ov-seq nw-label">seq ${escapeHtml(String(row.agreement.seq))}</span>`;
}

/** The first 64 bits of the on-chain commitment, for the hash-only Redaction's 32×2 grid. */
const hashBitsOf = (hex) => {
  const clean = String(hex ?? '').replace(/^0x/, '').slice(0, 16);
  if (clean.length < 16) return null;
  return [...clean].flatMap((h) => [8, 4, 2, 1].map((b) => (parseInt(h, 16) & b) !== 0));
};

const bodyLabelOf = (entry) =>
  entry.bodyType === 'Sealed' ? (entry.decrypted ? 'Sealed · decrypted' : 'Sealed · not decrypted') : entry.bodyType === 'None' ? 'Hash-only' : 'Plain';

/**
 * One message block. The on-chain fields come from the record and are re-read
 * live by the script. `data-row` is the only attribute the script needs; the
 * rest are there for a reader with view-source.
 */
function row(entry, { explorer }) {
  const sealed = entry.bodyType === 'Sealed';
  const shut = sealed && !entry.decrypted;
  const hashOnly = entry.bodyType === 'None';
  const quiet = shut || hashOnly;
  const bodyLabel = bodyLabelOf(entry);

  // The reason is shown on EVERY row, so a row that was decrypted is never
  // confusable with one that was always public.
  let content;
  if (entry.plaintext) {
    const lift = entry.decrypted ? `<span class="ov-lift" data-lift>${redaction({ state: 'sealed', text: 'decrypted' })}</span>` : '';
    content = `<div class="ov-body">${lift}<pre class="ov-plaintext"><code>${escapeHtml(entry.plaintext)}</code></pre></div><p class="ov-why nw-small nw-dim">${escapeHtml(entry.reason ?? '')}</p>`;
  } else if (hashOnly && hashBitsOf(entry.payloadHashOnChain)) {
    content = `<div class="ov-body">${redaction({ state: 'hash', hashBits: hashBitsOf(entry.payloadHashOnChain) })}</div><p class="ov-withheld nw-small nw-dim">${escapeHtml(entry.reason ?? 'no content on chain')}</p>`;
  } else {
    content = `<div class="ov-body">${redaction({ state: 'sealed', text: 'no key held' })}</div><p class="ov-withheld nw-small nw-dim">${escapeHtml(entry.reason ?? 'no content on chain')}</p>`;
  }

  // The explorer indexes the public network only; on a devnet the link would
  // either 404 or, worse, point at an unrelated event on another chain.
  const explorerCell = explorer.indexesThisChain
    ? `<a class="ov-explorer nw-quiet" href="${escapeHtml(`${explorer.base}?agent=${entry.from}`)}" target="_blank" rel="noopener">View on explorer.scalarnet.io</a>`
    : `<span class="ov-explorer is-off nw-sage" title="${escapeHtml(explorer.note)}">Not in explorer.scalarnet.io</span>`;

  const checks = [
    `<li class="ov-check" data-check="signature">${
      entry.signatureVerified
        ? badge('ok', 'Signature verified (operator)', { title: 'sr25519 over blake2_256("ScalarMsg/v1|" ‖ genesis ‖ SCALE(envelope)), verified by the read-only tool' })
        : badge('bad', 'Signature did NOT verify (operator)')
    }</li>`,
    `<li class="ov-check" data-check="commitment">${entry.plaintext ? badge('pending', 'Hashing in your browser…') : badge('na', 'No plaintext to hash', { title: entry.reason ?? '' })}</li>`,
  ].join('');

  const fieldRow = (label, html) => `<div class="ov-field"><dt class="nw-label">${label}</dt>${leader()}<dd>${html}</dd></div>`;

  return `<li class="ov-row${quiet ? ' is-quiet' : ''}" id="row-${escapeHtml(entry.id)}" data-row="${escapeHtml(entry.id)}" data-block="${escapeHtml(String(entry.block))}" data-extrinsic-index="${escapeHtml(String(entry.extrinsicIndex))}" data-extrinsic-hash="${escapeHtml(entry.extrinsicHash)}" data-payload-hash="${escapeHtml(entry.payloadHashOnChain ?? '')}" data-kind="${escapeHtml(entry.kind)}">
  <header class="ov-row-head">
    <span class="ov-kind nw-h3">${escapeHtml(entry.kind)}</span>
    ${tag({ state: shut ? 'sealed' : 'record', text: bodyLabel })}
    <span class="nw-label ov-when" data-body="${escapeHtml(entry.bodyType ?? 'unknown')}">block <span class="nw-mono">#${escapeHtml(String(entry.block))}</span> · ${escapeHtml(entry.timestamp)}</span>
    <span class="nw-tag ov-disagree" data-state="dispute" hidden><span class="nw-dot" aria-hidden="true"></span>${DISAGREE_WORD}</span>
  </header>
  <dl class="ov-fields">
    ${fieldRow('From', who(entry.from, entry.fromName))}
    ${fieldRow('To', who(entry.to, entry.toName))}
    ${fieldRow('Agreement', agreementOf(entry))}
    ${fieldRow('Payload hash', `<code class="nw-mono ov-hash" data-field="payloadHash">${escapeHtml(entry.payloadHashOnChain ?? '—')}</code>`)}
  </dl>
  <p class="ov-prov nw-receipt-line" data-prov="row">Recorded by the read-only tool; not yet re-read in this browser.</p>
  <div class="ov-content">${content}</div>
  <ul class="ov-checks">${checks}</ul>
  <p class="ov-links nw-small">${explorerCell}</p>
</li>`;
}

function howToRead() {
  return `<section class="nw-section ov-htr" aria-labelledby="htr-h">
  <span class="nw-label nw-eyebrow" id="htr-h">How to read this</span>
  <dl class="ov-htr-list">
${HOW_TO_READ.map(([term, text]) => `    <div class="ov-htr-row"><dt class="nw-label">${escapeHtml(term)}</dt>${leader()}<dd class="nw-body">${escapeHtml(text)}</dd></div>`).join('\n')}
  </dl>
</section>`;
}

/** The six-row Ledger: index, extrinsic, message, sender, state; the counts come from the record. */
function ledgerOf(rows, total) {
  const shown = rows.slice(0, LEDGER_ROWS);
  const body = ledger({
    head: ['#', 'Extrinsic', 'Message', 'From', 'State'],
    rows: shown.map((r, i) => ({
      id: r.id,
      cells: [
        String(i + 1),
        `<a href="#row-${escapeHtml(r.id)}">${escapeHtml(short(r.extrinsicHash))}</a>`,
        `${escapeHtml(r.kind)} · ${escapeHtml(bodyLabelOf(r))}`,
        escapeHtml(r.fromName ?? short(r.from)),
        tag({ state: r.bodyType === 'Sealed' && !r.decrypted ? 'sealed' : 'record', text: r.bodyType === 'Sealed' && !r.decrypted ? 'SEALED' : 'RECORD' }),
      ],
    })),
    className: 'ov-ledger',
  });
  return `${body}
  <p class="nw-pager nw-label"><span>${formatInt(shown.length)} of ${formatInt(total)}</span><a href="#all">all ${formatInt(total)} →</a></p>`;
}

/**
 * The whole page. `sample` is the parsed oversight-sample.json; `css` the
 * assembled stylesheet to inline; `facts` chain-facts.json for the footer
 * (the record's provenance stands in when absent); `inlineData` embeds the
 * sample in the page for the standalone copy, which has no network and no
 * sibling JSON file.
 */
export function renderOversight({ sample, css = null, facts = null, inlineData = false, standalone = false, inlineScript = null } = {}) {
  const { provenance, summary, rows } = sample;
  for (const path of ['explorer', 'httpEndpoint', 'callIndex', 'genesisHash', 'chainName', 'networkNote']) {
    if (provenance?.[path] === undefined || provenance[path] === null) {
      throw new Error(`oversight-sample.json: provenance.${path} is missing — re-run swarm/tools/decrypt-messages.mjs`);
    }
  }
  if (!summary?.thread) throw new Error('oversight-sample.json: no complete thread was found when it was generated');
  const threadIds = new Set(summary.thread?.rowIds ?? []);
  const threadRows = rows.filter((r) => threadIds.has(r.id));
  const otherRows = rows.filter((r) => !threadIds.has(r.id));
  const explorer = provenance.explorer;

  const record = { method: 'FILE', url: 'oversight-sample.json', fetchedAt: provenance.generatedAt, block: provenance.generatedAtBlock, raw: 'oversight-sample.json' };
  const live = { method: 'GET', url: provenance.httpEndpoint, fetchedAt: null, block: null, raw: 'oversight-sample.json', computed: 'blake2b-256 of each plaintext, in this browser, against the commitment' };
  const figures = [
    ...FIGURES.map(([key, label]) =>
      reading({
        key,
        label,
        figure: key === 'selfCheck' ? summary.selfCheck : `${summary[key]} of ${summary.rows}`,
        size: key === 'selfCheck' ? 'body' : 'm',
        state: 'record',
        source: key === 'selfCheck' ? { ...record, computed: 're-derived from the master seed and compared with agents.messagingKey' } : record,
        stack: true,
      }),
    ),
    reading({ key: RECHECK[0], label: RECHECK[1], figure: null, live: true, size: 'm', state: 'live', source: live, stack: true }),
  ].join('\n');

  const thread = threadRows.map((r) => row(r, { explorer })).join(`\n<li class="ov-join" aria-hidden="true">${leader({ arrow: true })}</li>\n`);

  const sampleScript = inlineData ? `<script type="application/json" id="oversight-sample">${JSON.stringify(sample).replace(/</g, '\\u003c')}</script>` : '';
  const foot = facts?.provenance
    ? { genesisHash: facts.provenance.genesisHash, specVersion: facts.provenance.specVersion, nodeVersion: facts.provenance.nodeVersion ?? null, builtAt: facts.provenance.fetchedAt, block: facts.provenance.readAtBlock }
    : { genesisHash: provenance.genesisHash, specVersion: provenance.specVersion, nodeVersion: null, builtAt: provenance.generatedAt, block: provenance.generatedAtBlock };

  return `<!doctype html>
<html lang="en">
<head>
${head({
  title: `${TITLE} — Scalar Commons`,
  description:
    'A sample of real agent-to-agent messages from a Scalar Commons development chain: the public metadata every observer sees, the encrypted bodies an operator opened with escrowed keys, and the commitment your own browser recomputes to check that the plaintext is the one the chain committed to.',
  css,
  scripts: inlineScript === null ? ['oversight.js'] : [],
  extraHead: sampleScript ? `${sampleScript}\n` : '',
})}
</head>
<body class="ov-body-page"${standalone ? ' data-standalone=""' : ''}>
<a class="nw-visually-hidden" href="#rows-h">Skip to the messages</a>
${topBar({ current: 'oversight' })}
<noscript><p class="nw-band nw-frame">The live re-read and the in-browser hash check need JavaScript, which is off. Every on-chain field and plaintext below is still shown exactly as the read-only tool recorded it.</p></noscript>
<main class="nw-frame ov" aria-labelledby="ov-h">
  <section class="nw-section ov-hero">
    <span class="nw-eyebrow">${tag({ state: 'record', text: 'Oversight · record' })}</span>
    <h1 id="ov-h" class="nw-display">${escapeHtml(TITLE)}</h1>
${rows.length === 40 ? `    <p class="nw-body ov-standfirst">${escapeHtml(STANDFIRST)}</p>\n` : ''}    <div class="nw-prose ov-explanation">
${EXPLANATION.map((sentence) => `      <p class="nw-dim">${sentence}</p>`).join('\n')}
    </div>
    <p class="ov-label nw-small" role="note">${tag({ state: 'operator', text: provenance.chainName })} <span class="nw-dim">${escapeHtml(provenance.networkNote)}</span></p>
    <p class="ov-status-line"><span class="nw-tag ov-status" data-ov-status data-state="connecting" role="status" aria-live="off"><span class="nw-dot" aria-hidden="true"></span><span data-status-text>Reading the chain…</span><span class="nw-dim"> · </span><span data-status-network>${escapeHtml(provenance.chainName)}</span></span></p>
    <div class="nw-row ov-figures">
${figures}
    </div>
  </section>
${howToRead()}
  <section class="nw-section ov-thread" aria-labelledby="thread-h">
    <span class="nw-label nw-eyebrow">01 · One negotiation, end to end</span>
    <h2 id="thread-h" class="nw-h2">Offer → Accept → Delivery, on a single agreement</h2>
    <p class="nw-body nw-dim ov-lede">The same three messages a human would recognise as a deal being struck: an offer, its acceptance, and notice that the work was delivered. All three are encrypted on chain under the agreement tag <code class="nw-mono">${escapeHtml(summary.thread.agreement)}</code>; all three were opened with the operator’s keys.</p>
    <ol class="ov-rows ov-rows-thread">
${thread}
    </ol>
  </section>
  <section class="nw-section ov-sample" aria-labelledby="rows-h">
    <span class="nw-label nw-eyebrow">02 · The sample</span>
    <h2 id="rows-h" class="nw-h2">${escapeHtml(String(rows.length))} messages, as the chain carries them</h2>
    <p class="nw-body nw-dim ov-lede">Read from <code class="nw-mono">${escapeHtml(provenance.endpoint)}</code> at block <code class="nw-mono">#${escapeHtml(String(provenance.generatedAtBlock))}</code>, ${escapeHtml(provenance.generatedAt)}. Greyed rows are the ones the operator could not open: it holds no key for them, or the content never travelled on chain at all.</p>
    ${ledgerOf(otherRows, rows.length)}
    <ol class="ov-rows" id="all">
${otherRows.map((r) => row(r, { explorer })).join('\n')}
    </ol>
  </section>
  <section class="nw-section ov-foot">
    <p class="nw-small nw-dim">Generated by <code class="nw-mono">${escapeHtml(provenance.tool)}</code>, which signs nothing and submits nothing. Genesis <code class="nw-mono">${escapeHtml(provenance.genesisHash)}</code>, runtime spec ${escapeHtml(String(provenance.specVersion))}. ${escapeHtml(provenance.scanStoppedBecause ?? '')}</p>
    <p class="nw-small nw-dim">${escapeHtml(summary.selfCheckDetail.method)}.</p>
  </section>
</main>
<p class="sr-status nw-visually-hidden" aria-live="polite"></p>
${footer({ facts: foot })}
${inlineScript === null ? '' : `<script type="module">${inlineScript.replace(/<\/script/gi, '<\\/script')}</script>`}
</body>
</html>
`;
}
