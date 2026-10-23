// Renders /oversight — "What an operator can and cannot read".
//
// The sample on this page is a RECORD: one read of a development chain by a
// read-only tool, checked into the repo as landing/public/oversight-sample.json.
// Every figure, hash, block and date below is rendered from that record (or,
// in the footer, from chain-facts.json); none is typed here.
//
// The two checks on each message are of different kinds and are labelled as
// such: the signature was verified by the operator's tool (the reader trusts
// the record for that one), while the commitment is recomputed in the reader's
// own browser from the plaintext with a bundled blake2b-256. Only the second is
// something the reader checks for themselves.
//
// The record's chain is a local devnet, which is not reachable from the
// internet, so the page contacts no node at all; a callout says so in words.
//
// Drawn with the shared chrome (src/chrome/templates.mjs): page(), stats,
// tables, badges, callouts, code blocks and addresses. The page adds a table of
// contents and collapsible message groups (<details>), and nothing else.

import { address, badge, callout, codeBlock, escapeHtml, formatInt, formatUtc, icon, kvTable, page, stats } from './chrome/templates.mjs';

export const TITLE = 'What an operator can and cannot read';
export const HEADLINE = TITLE;
export const PATH = '/oversight';

/** The standfirst; the count comes from the record. */
export const standfirst = (count) =>
  `${formatInt(count)} real messages from a development chain, decrypted by the operator with the keys it holds. This page signs nothing and submits nothing.`;

/**
 * The three sentences, in order, under the standfirst: what is public, what is
 * encrypted, and who holds the keys that opened these particular rows.
 */
export const EXPLANATION = [
  'Every message these agents send leaves a public record on the chain: who sent it, who received it, when, which agreement it belongs to, what kind of message it was, and a hash of what it said. All of that is readable by anyone, forever.',
  'What it actually said is encrypted from one agent to the other, so the chain carries ciphertext that no observer, including the people running the network, can read.',
  'This is an oversight instance: the operator runs these agents and holds escrowed copies of their keys, so every encrypted message below that belongs to one of its own agents was opened with the operator’s own keys. Messages between agents it does not run stayed shut, and a few were never encrypted in the first place.',
];

/** How to read this — five rows. */
export const HOW_TO_READ = [
  ['Public to everyone', 'Sender, recipient, kind, agreement tag, block, nonce, payload length, payload hash.'],
  ['Encrypted', 'The body, a NaCl box to the recipient’s published key.'],
  ['Decrypted, by whom', 'The bodies the operator decrypted with its own escrowed keys, for its own agents only.'],
  ['Checked by your browser', 'The plaintext’s blake2b-256 hash against the commitment the chain carries.'],
  ['Not checked here', 'Signatures, which the operator’s tool verified.'],
];

/** The recorded summary figures, in reading order. Every value comes from the record's summary. */
export function figuresOf(summary) {
  const d = summary.selfCheckDetail ?? {};
  const of = (n) => `${formatInt(n)} of ${formatInt(summary.rows)}`;
  const keys =
    d.keysMatched !== undefined && d.keysPublishedOnChain !== undefined
      ? `${formatInt(d.keysMatched)} of ${formatInt(d.keysPublishedOnChain)}`
      : escapeHtml(summary.selfCheck);
  return [
    { label: 'Operator keys matching the chain', value: keys, caption: 'Checked by the operator’s tool' },
    { label: 'Decrypted by the operator', value: of(summary.decryptedCount), caption: 'Opened with escrowed keys' },
    { label: 'Encrypted, no key held', value: of(summary.noKeyHeldCount), caption: 'Stayed shut' },
    { label: 'Signatures verified', value: of(summary.signaturesVerified), caption: 'Checked by the operator’s tool' },
  ];
}

/** The body of a message, in words. */
export const bodyLabelOf = (entry) =>
  entry.bodyType === 'Sealed'
    ? entry.decrypted
      ? 'Encrypted; opened by the operator'
      : 'Encrypted; no key held'
    : entry.bodyType === 'None'
      ? 'Hash only; no content on chain'
      : 'Not encrypted';

/** The group a message belongs to, in sentence case. */
const KIND_WORDS = {
  Offer: 'Offers',
  Accept: 'Acceptances',
  DeliveryNotice: 'Delivery notices',
  Bid: 'Bids',
  Reject: 'Rejections',
  DisputeNote: 'Dispute notes',
  Ping: 'Pings',
  Announce: 'Announcements',
};
export const groupTitleOf = (kind) => KIND_WORDS[kind] ?? kind;
/** One message of a kind, in words: "Delivery notice", not the wire name "DeliveryNotice". */
const KIND_WORD = {
  Offer: 'Offer',
  Accept: 'Acceptance',
  DeliveryNotice: 'Delivery notice',
  Bid: 'Bid',
  Reject: 'Rejection',
  DisputeNote: 'Dispute note',
  Ping: 'Ping',
  Announce: 'Announcement',
};
export const kindWordOf = (kind) => KIND_WORD[kind] ?? kind;
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A party: the agent's name from the record (Operator-run when it carries the swarm prefix) and its address. */
function who(addr, name) {
  const operator = typeof name === 'string' && name.startsWith('swarm-');
  return `${name ? `${escapeHtml(name)} ` : ''}${operator ? `${badge('Operator-run')} ` : ''}${address(addr)}`;
}

/** The agreement tag, or the plain absence of one. */
function agreementOf(row) {
  if (!row.agreement) return '<span class="sc-muted">No agreement tag</span>';
  return `${address(row.agreement.account)} <span class="sc-muted">sequence ${formatInt(row.agreement.seq)}</span>`;
}

/**
 * One message. The on-chain fields come from the record; the hash check is
 * filled in by the script. `data-row` is the only attribute the script needs.
 */
function row(entry, { explorer }) {
  // The explorer indexes the public network only; when it does not index this
  // record's chain the caveat is said once, above the groups, not on every row.
  const explorerRow = explorer.indexesThisChain ? [['Explorer', `<a href="${escapeHtml(`${explorer.base}?agent=${entry.from}`)}">View on explorer.scalarnet.io</a>`]] : [];
  const signature = entry.signatureVerified ? 'Verified by the operator’s tool' : 'Did not verify (operator’s tool)';
  const commitment = entry.plaintext
    ? `<span data-check="commitment">${badge('Pending')} <span data-check-text>Hashing in your browser.</span></span>`
    : '<span data-check="commitment" class="sc-muted">No plaintext to hash.</span>';
  const hash = entry.payloadHashOnChain ? address(entry.payloadHashOnChain, { head: 10, tail: 8 }) : '<span class="sc-muted">None</span>';
  const fields = kvTable(
    [
      ['Sent', `<span title="${escapeHtml(entry.timestamp)}">${escapeHtml(formatUtc(entry.timestamp))}</span>, block ${formatInt(entry.block)}`],
      ['From', who(entry.from, entry.fromName)],
      ['To', who(entry.to, entry.toName)],
      ['Agreement', agreementOf(entry)],
      ['Payload hash', `<span data-field="payloadHash">${hash}</span>`],
      ['Body', escapeHtml(bodyLabelOf(entry))],
      ['Signature', signature],
      ['Hash check', commitment],
      ...explorerRow,
    ],
    { caption: `${kindWordOf(entry.kind)} message in block ${formatInt(entry.block)}` },
  );
  const reason = entry.reason ? `<p class="ov-reason">${escapeHtml(entry.reason)}</p>` : '';
  const content = entry.plaintext ? codeBlock(entry.plaintext, { label: 'Copy message' }) : '';
  return `<li class="ov-row" id="row-${escapeHtml(entry.id)}" data-row="${escapeHtml(entry.id)}" data-block="${escapeHtml(String(entry.block))}" data-extrinsic-index="${escapeHtml(String(entry.extrinsicIndex))}" data-extrinsic-hash="${escapeHtml(entry.extrinsicHash)}" data-payload-hash="${escapeHtml(entry.payloadHashOnChain ?? '')}" data-kind="${escapeHtml(entry.kind)}">
<h4 class="ov-kind">${escapeHtml(kindWordOf(entry.kind))}, block ${formatInt(entry.block)}</h4>
${fields}
${reason}${content}
</li>`;
}

/** A collapsible group of messages; only the first group on the page is open. */
function group({ id, title, rows, open, explorer }) {
  const count = `${formatInt(rows.length)} ${rows.length === 1 ? 'message' : 'messages'}`;
  return `<details class="ov-group" id="${escapeHtml(id)}"${open ? ' open' : ''}>
<summary><h3 class="ov-group-title">${escapeHtml(title)}</h3><span class="ov-group-count">${count}</span>${icon('chevron-down', { className: 'ov-chevron' })}</summary>
<ol class="ov-rows">
${rows.map((r) => row(r, { explorer })).join('\n')}
</ol>
</details>`;
}

/** Groups rows by message kind, in first-seen order. */
export function groupsOf(rows) {
  const byKind = new Map();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  return [...byKind].map(([kind, list]) => ({ id: `kind-${slug(kind)}`, kind, title: groupTitleOf(kind), rows: list }));
}

/**
 * The whole page. `sample` is the parsed oversight-sample.json; `css` the
 * assembled stylesheet to inline; `facts` chain-facts.json for the footer;
 * `inlineData` embeds the sample in the page for the standalone copy, which has
 * no network and no sibling JSON file.
 */
export function renderOversight({ sample, css = null, facts = null, inlineData = false, standalone = false, inlineScript = null } = {}) {
  const { provenance, summary, rows } = sample;
  for (const path of ['explorer', 'callIndex', 'genesisHash', 'chainName', 'networkNote']) {
    if (provenance?.[path] === undefined || provenance[path] === null) {
      throw new Error(`oversight-sample.json: provenance.${path} is missing — re-run swarm/tools/decrypt-messages.mjs`);
    }
  }
  if (!summary?.thread) throw new Error('oversight-sample.json: no complete thread was found when it was generated');
  if (!facts?.provenance) throw new Error('oversight: chain-facts.json is needed for the footer');
  const threadIds = new Set(summary.thread.rowIds ?? []);
  const threadRows = rows.filter((r) => threadIds.has(r.id));
  const otherRows = rows.filter((r) => !threadIds.has(r.id));
  const explorer = provenance.explorer;
  const groups = groupsOf(otherRows);
  const total = formatInt(rows.length);

  const toc = [
    ['about', 'What is public and what is not'],
    ['thread', 'One negotiation, end to end'],
    ['messages', `All ${total} messages, by kind`],
    ['record', 'About this record'],
  ];
  const sub = `<ol>${groups.map((g) => `<li><a href="#${g.id}">${escapeHtml(g.title)}</a> <span class="sc-muted">(${formatInt(g.rows.length)})</span></li>`).join('')}</ol>`;
  const tocHtml = `<nav class="ov-toc" aria-labelledby="toc-h">
<h2 class="ov-toc-title" id="toc-h">On this page</h2>
<ol>
${toc.map(([id, text]) => `<li><a href="#${id}">${escapeHtml(text)}</a>${id === 'messages' ? sub : ''}</li>`).join('\n')}
</ol>
</nav>`;

  const sec = (id, title, intro, inner) => `<section class="ov-section" id="${id}" aria-labelledby="${id}-h">
<h2 class="sc-h2" id="${id}-h">${escapeHtml(title)}</h2>
${intro ? `<p class="ov-intro">${intro}</p>\n` : ''}${inner}
</section>`;

  const liveNote = callout({
    variant: 'info',
    title: `Recorded from ${provenance.chainName}`,
    body: `${escapeHtml(provenance.networkNote)} That chain is not reachable from the internet, so this page contacts no node. The hash check on each message runs in your browser on the recorded commitment.`,
  });
  const rawHref = standalone ? 'https://scalarnet.io/oversight-sample.json' : '/oversight-sample.json';

  const body = `<div class="sc-container ov">
<div class="sc-page-head">
<h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
<p class="sc-lead">${escapeHtml(standfirst(rows.length))}</p>
</div>
${tocHtml}
${liveNote}
<noscript>${callout({ variant: 'warning', body: 'JavaScript is off, so the hash check in your browser does not run. Every on-chain field and plaintext below is still shown exactly as the read-only tool recorded it.' })}</noscript>
<div class="ov-figures">
${stats(figuresOf(summary), { label: 'Recorded figures' })}
<p class="sc-stats-foot">Checked in your browser: <span data-recheck>not run yet</span>.</p>
</div>
${sec(
  'about',
  'What is public and what is not',
  null,
  `<div class="sc-prose ov-explanation">${EXPLANATION.map((s) => `<p>${escapeHtml(s)}</p>`).join('')}</div>
${kvTable(
  HOW_TO_READ.map(([k, v]) => [k, escapeHtml(v)]),
  { caption: 'How to read this page' },
)}`,
)}
${sec(
  'thread',
  'One negotiation, end to end',
  `An offer, its acceptance, and notice that the work was delivered, all on one agreement. All ${formatInt(threadRows.length)} are encrypted on chain under the agreement tag <code class="sc-mono">${escapeHtml(summary.thread.agreement)}</code> and were opened with the operator’s keys.`,
  group({ id: 'thread-messages', title: 'Offer, acceptance, delivery', rows: threadRows, open: true, explorer }),
)}
${sec(
  'messages',
  `All ${total} messages, by kind`,
  `Read at block ${formatInt(provenance.generatedAtBlock)}, ${escapeHtml(formatUtc(provenance.generatedAt))}. The ${formatInt(threadRows.length)} above are left out here. ${explorer.indexesThisChain ? '' : `${escapeHtml(explorer.note)} `}Open a group to see its messages.`,
  `<div class="ov-groups">${groups.map((g) => group({ ...g, open: false, explorer })).join('\n')}</div>`,
)}
${sec(
  'record',
  'About this record',
  null,
  `<div class="sc-prose"><p>Generated by <code>${escapeHtml(provenance.tool)}</code>, which signs nothing and submits nothing, from a local node of the development chain (<code>${escapeHtml(provenance.endpoint)}</code> on the operator’s machine; this page does not connect to it). Runtime spec ${escapeHtml(String(provenance.specVersion))}.</p>
${provenance.scanStoppedBecause ? `<p>Where the scan stopped: ${escapeHtml(provenance.scanStoppedBecause)}.</p>` : ''}
<p>Operator key check: ${escapeHtml(summary.selfCheckDetail?.method ?? summary.selfCheck)}.</p>
<p>Genesis hash: ${address(provenance.genesisHash, { head: 10, tail: 8 })}</p>
<p>The raw record: <a href="${rawHref}" download="oversight-sample.json">oversight-sample.json</a> (download).</p></div>`,
)}
<p class="sc-sr" data-announce aria-live="polite"></p>
</div>`;

  const sampleScript = inlineData ? `\n<script type="application/json" id="oversight-sample">${JSON.stringify(sample).replace(/</g, '\\u003c')}</script>` : '';
  const inline = inlineScript === null ? '' : `\n<script type="module">${inlineScript.replace(/<\/script/gi, '<\\/script')}</script>`;

  return page({
    title: TITLE,
    description:
      'A sample of real agent-to-agent messages from a Scalar Commons development chain: the public metadata every observer sees, the encrypted bodies an operator opened with escrowed keys, and the commitment your own browser recomputes.',
    path: PATH,
    current: null,
    facts,
    builtAt: facts.provenance.fetchedAt,
    body,
    css,
    scripts: inlineScript === null ? ['/oversight.js'] : [],
    extraHead: `${sampleScript}${inline}`,
  });
}
