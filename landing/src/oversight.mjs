// Renders /oversight — "What an operator can and cannot read".
//
// This page states its figures at build time, because what it shows is a
// RECORD: one read of a chain by a read-only tool, checked into the repo as
// landing/public/oversight-sample.json. Every on-chain field is rendered from
// the record. The reader's browser recomputes each plaintext's blake2b-256
// against the chain's commitment (arithmetic on bytes already in the page)
// and — only when the record names a public node — re-reads each message from
// the chain and says whether it agrees. The record's node is a local
// development chain, so the hosted page shows the recorded values, says so in
// one sentence, and never tries to reach it (SITE-REDESIGN.md, Appendix A 23).
//
// Drawn on the shared chrome (src/chrome): page(), section(), stats(),
// kvTable(), table(), callout(), address(), link(). Nothing here types a
// figure: every count, date, hash and address comes from the record or from
// chain-facts.json. The page is long, so it opens with a table of contents and
// each group of messages is a native <details>: the first open, the rest shut.

import { isPublicEndpoint } from './oversight/endpoint.js';
import { CHECK, DISAGREE_WORD, PROVENANCE, RECORDED_ONLY, SIGNATURE, STATUS, kindWord } from './oversight/words.js';
import { address, callout, escapeHtml, formatInt, formatUtc, icon, kvTable, link, page, section, stats, table, truncateMiddle } from './chrome/templates.mjs';

export { isPublicEndpoint, CHECK, DISAGREE_WORD, RECORDED_ONLY, SIGNATURE, STATUS, kindWord };

export const TITLE = 'What an operator can and cannot read';
export const DESCRIPTION =
  'A sample of real agent-to-agent messages from a Scalar Commons development chain: the public metadata every observer sees, the encrypted bodies an operator opened with escrowed keys, and the commitment your own browser recomputes to check that the plaintext is the one the chain committed to.';
export const STANDFIRST =
  'Forty real messages from a development chain, decrypted by the operator with the keys it holds. This page signs nothing and submits nothing.';

/**
 * The three paragraphs, in order, under the lead: what is public, what is
 * encrypted, and who holds the keys that opened these particular rows.
 */
export const EXPLANATION = [
  'Every message these agents send leaves a public record on the chain: who sent it, who received it, when, which agreement it belongs to, what kind of message it was, and a hash of what it said — all of that is readable by anyone, forever.',
  'What it actually said is encrypted from one agent to the other, so the chain carries ciphertext that no observer, including the people running the network, can read.',
  'This is an oversight instance: the operator runs these agents and holds escrowed copies of their keys, so every encrypted row below that belongs to one of its own agents was opened with the operator’s own keys — rows between agents it does not run stayed shut, and a few rows were never encrypted in the first place.',
];

/** The recorded summary figures, in reading order: key into the sample's summary, label, caption. */
export const FIGURES = [
  ['selfCheck', 'Operator keys matching the chain', 'published keys, re-derived by the tool'],
  ['decryptedCount', 'Decrypted by the operator', 'sealed messages opened with escrowed keys'],
  ['noKeyHeldCount', 'Sealed, no key held', 'between agents the operator does not run'],
  ['signaturesVerified', 'Signatures verified', 'by the operator’s tool, not by this page'],
];
/** The fifth figure is the reader's own: filled by the browser after it has hashed every plaintext. */
export const RECHECK = ['rechecked', 'Re-checked in your browser', 'plaintexts hashed to their commitment'];

/** How to read this — five rows, verbatim from the brief. */
export const HOW_TO_READ = [
  ['Public to everyone', 'sender, recipient, kind, agreement tag, block, nonce, payload length, payload hash'],
  ['Encrypted', 'the body, a NaCl box to the recipient’s published key'],
  ['Decrypted, by whom', 'the bodies the operator decrypted with its own escrowed keys, for its own agents only'],
  ['Re-checked by your browser', 'the plaintext’s blake2b-256 against the chain’s commitment'],
  ['Not checked here', 'signatures, verified by the operator’s tool'],
];

/** The groups a message can fall into, after the thread: id, title, intro, membership. */
export const GROUPS = [
  {
    id: 'g-decrypted',
    title: 'Decrypted by the operator',
    intro: 'Sealed messages between the operator’s own agents, opened with the escrowed keys it holds. The negotiation above is not repeated here.',
    holds: (r) => r.bodyType === 'Sealed' && r.decrypted === true,
  },
  {
    id: 'g-plain',
    title: 'Public on chain',
    intro: 'Messages sent in plain text. Anyone can read them from the chain; no key was needed.',
    holds: (r) => r.bodyType === 'Plain',
  },
  {
    id: 'g-sealed',
    title: 'Sealed, no key held',
    intro: 'Messages between agents the operator does not run. It holds no key for them, so only the public fields are readable.',
    holds: (r) => r.bodyType === 'Sealed' && r.decrypted !== true,
  },
  {
    id: 'g-hash-only',
    title: 'Hash-only',
    intro: 'Messages whose content never travelled on chain. Only its commitment did, so there is nothing to decrypt.',
    holds: (r) => r.bodyType === 'None',
  },
];
export const THREAD_GROUP = { id: 'g-thread', title: 'One negotiation, end to end' };
export const ALL_GROUP = { id: 'g-all', title: 'All messages, in block order' };

export const MESSAGE_COLUMNS = [{ label: 'Block' }, { label: 'Kind' }, { label: 'From and to' }, { label: 'Message' }, { label: 'Checks' }];
export const INDEX_COLUMNS = [{ label: 'Block' }, { label: 'Kind' }, { label: 'From' }, { label: 'To' }, { label: 'Body' }, { label: 'Shown in' }];

const anchorOf = (id) => `msg-${id}`;
const cell = (...lines) => `<div class="ov-cell">${lines.filter((l) => l !== null && l !== undefined && l !== '').join('')}</div>`;
const caption = (text, title = null) => `<span class="sc-caption"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;

/** The record's reason for a row's state, verbatim; it is what keeps "public" and "decrypted" apart. */
const reasonOf = (r) => r.reason ?? '';

/** "Decrypted" / "Public" / "Sealed" / "Hash-only": the body's state in one or two words, for the index. */
export const bodyWordOf = (r) =>
  r.bodyType === 'Sealed' ? (r.decrypted ? 'Decrypted' : 'Sealed, no key held') : r.bodyType === 'Plain' ? 'Public' : r.bodyType === 'None' ? 'Hash-only' : String(r.bodyType ?? 'Unknown');

/** A party line: label, the agent's name from the record, its address (linked to the explorer only when the explorer indexes this chain). */
function party(label, addr, name, explorer) {
  const href = explorer.indexesThisChain ? `${explorer.base}?agent=${addr}` : null;
  return `<div class="ov-party"><span class="ov-k">${escapeHtml(label)}</span>${name ? `<span>${escapeHtml(name)}</span>` : ''}${address(addr, { href })}</div>`;
}

/** The agreement tag, or its honest absence. */
function agreementLine(r) {
  if (!r.agreement) return `<div class="ov-party"><span class="ov-k">Agreement</span><span class="sc-muted">None</span></div>`;
  return `<div class="ov-party"><span class="ov-k">Agreement</span>${address(r.agreement.account)}${caption(`no. ${formatInt(r.agreement.seq)}`)}</div>`;
}

/** One message as a table row: block and time, kind, parties, message, checks. */
function messageRow(r, { explorer, recheck }) {
  const id = r.id;
  const hasText = r.plaintext !== null && r.plaintext !== undefined;
  const absent =
    r.bodyType === 'None' ? 'No content on chain.' : r.bodyType === 'Sealed' ? `Encrypted payload, ${formatInt(r.payloadLen)} bytes; not opened.` : 'No plaintext.';
  const message = hasText
    ? cell(caption(reasonOf(r)), `<code class="sc-mono ov-plaintext">${escapeHtml(r.plaintext)}</code>`)
    : cell(caption(reasonOf(r)), `<span class="sc-muted">${escapeHtml(absent)}</span>`);
  const checks = [
    `<li data-check="signature" data-state="${r.signatureVerified ? 'ok' : 'bad'}" title="${escapeHtml(SIGNATURE.method)}">${escapeHtml(r.signatureVerified ? SIGNATURE.ok : SIGNATURE.bad)}</li>`,
    hasText
      ? `<li data-check="commitment" data-for="${escapeHtml(id)}" data-state="pending">${escapeHtml(CHECK.pending)}</li>`
      : `<li data-check="commitment" data-for="${escapeHtml(id)}" data-state="na" title="${escapeHtml(reasonOf(r))}">${escapeHtml(CHECK.none)}</li>`,
    r.payloadHashOnChain
      ? `<li>${cell('<span class="ov-k">Commitment on chain</span>', `<span data-field="payloadHash" data-for="${escapeHtml(id)}">${address(r.payloadHashOnChain, { head: 10, tail: 6 })}</span>`)}</li>`
      : `<li>${cell('<span class="ov-k">Commitment on chain</span>', '<span class="sc-muted">None</span>')}</li>`,
    recheck ? `<li class="sc-caption" data-prov="row" data-for="${escapeHtml(id)}">${escapeHtml(PROVENANCE.pending)}</li>` : '',
    `<li class="ov-disagree" data-disagree data-for="${escapeHtml(id)}" hidden>${escapeHtml(DISAGREE_WORD)}</li>`,
  ].join('');
  return [
    cell(`<span class="sc-num" id="${anchorOf(id)}" data-block="${escapeHtml(String(r.block))}" data-extrinsic-index="${escapeHtml(String(r.extrinsicIndex))}" data-extrinsic-hash="${escapeHtml(r.extrinsicHash)}">${formatInt(r.block)}</span>`, caption(formatUtc(r.timestamp), r.timestamp)),
    `<span data-field="kind" data-for="${escapeHtml(id)}" data-kind="${escapeHtml(r.kind)}">${escapeHtml(kindWord(r.kind))}</span>`,
    cell(party('From', r.from, r.fromName, explorer), party('To', r.to, r.toName, explorer), agreementLine(r)),
    message,
    `<ul class="ov-checks">${checks}</ul>`,
  ];
}

/** A party in the index: the name and the address truncated, the full address in the title; the copy buttons live on the message rows. */
const shortParty = (addr, name) => `<span class="ov-who">${name ? `<span>${escapeHtml(name)}</span>` : ''}<span class="sc-mono" title="${escapeHtml(addr)}">${escapeHtml(truncateMiddle(addr))}</span></span>`;

/** One line of the index: block, kind, parties, body state, and a link to the message where it is shown. */
function indexRow(r, groupOf) {
  const g = groupOf.get(r.id);
  return [
    cell(`<span class="sc-num">${formatInt(r.block)}</span>`, caption(formatUtc(r.timestamp), r.timestamp)),
    escapeHtml(kindWord(r.kind)),
    shortParty(r.from, r.fromName),
    shortParty(r.to, r.toName),
    escapeHtml(bodyWordOf(r)),
    `<a href="#${anchorOf(r.id)}">${escapeHtml(g.title)}</a>`,
  ];
}

/** A collapsible group of messages: a native <details>, the shared table inside. */
function group({ id, title, intro, rows, open = false, columns, rowsHtml, className = 'ov-table' }) {
  const n = rows.length;
  return `<details class="ov-group" id="${escapeHtml(id)}"${open ? ' open' : ''}>
  <summary><h3 class="sc-h3">${escapeHtml(title)}</h3><span class="sc-caption">${formatInt(n)} ${n === 1 ? 'message' : 'messages'}</span>${icon('chevron-right')}${icon('chevron-down')}</summary>
  <div class="ov-group-body">
    ${intro ? `<p class="sc-body sc-muted">${intro}</p>` : ''}
    ${table({ columns, rows: rowsHtml, caption: title, className })}
  </div>
</details>`;
}

/**
 * The whole page. `sample` is the parsed oversight-sample.json; `facts`
 * chain-facts.json and `builtAt` the build instant, for the footer line;
 * `css` the assembled stylesheet to inline (tokens, fonts, chrome, then the
 * page's own). `scripts` names the page's one script.
 */
export function renderOversight({ sample, facts, builtAt, css = null, scripts = ['oversight.js'] } = {}) {
  if (!sample) throw new Error('renderOversight: no sample');
  if (!facts?.provenance || !builtAt) throw new Error('renderOversight: facts (chain-facts.json) and builtAt are needed for the footer line');
  const { provenance, summary, rows } = sample;
  for (const path of ['explorer', 'httpEndpoint', 'callIndex', 'genesisHash', 'chainName', 'networkNote']) {
    if (provenance?.[path] === undefined || provenance[path] === null) {
      throw new Error(`oversight-sample.json: provenance.${path} is missing — re-run swarm/tools/decrypt-messages.mjs`);
    }
  }
  if (!summary?.thread) throw new Error('oversight-sample.json: no complete thread was found when it was generated');
  const explorer = provenance.explorer;
  // The one decision that keeps this page off a private node: the record's
  // endpoint must be a public https:// or wss:// address, or no re-check is
  // offered and the page says so.
  const recheck = isPublicEndpoint(provenance.httpEndpoint);

  // ── the groups: the thread first, then by what the operator could do ──────
  const byId = new Map(rows.map((r) => [r.id, r]));
  const threadRows = (summary.thread.rowIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  const threadIds = new Set(threadRows.map((r) => r.id));
  const rest = rows.filter((r) => !threadIds.has(r.id));
  const groups = [
    {
      ...THREAD_GROUP,
      intro: `The messages a human would recognise as a deal being struck: an offer, its acceptance, and notice that the work was delivered. All of them are encrypted on chain under the agreement tag <code class="sc-full">${escapeHtml(summary.thread.agreement)}</code>; all were opened with the operator’s keys.`,
      rows: threadRows,
      open: true,
    },
    ...GROUPS.map((g) => ({ id: g.id, title: g.title, intro: g.intro, rows: rest.filter(g.holds), open: false })),
  ];
  const placed = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
  const unplaced = rows.filter((r) => !placed.has(r.id));
  if (unplaced.length) groups.push({ id: 'g-other', title: 'Other messages', intro: 'Messages the groups above do not cover.', rows: unplaced, open: false });
  const shown = groups.filter((g) => g.rows.length > 0);
  const groupOf = new Map(shown.flatMap((g) => g.rows.map((r) => [r.id, g])));
  const inBlockOrder = [...rows].sort((a, b) => a.block - b.block || a.extrinsicIndex - b.extrinsicIndex || a.eventIndex - b.eventIndex);

  // ── the record ────────────────────────────────────────────────────────────
  const notes = [
    callout({ variant: 'info', title: provenance.chainName, body: escapeHtml(provenance.networkNote) }),
    recheck
      ? `<div data-ov-status data-state="reading">${callout({ variant: 'info', body: `<span data-status-text>${escapeHtml(STATUS.reading)}</span>` })}</div>`
      : callout({ variant: 'info', body: escapeHtml(RECORDED_ONLY) }),
  ].join('\n');
  const detail = summary.selfCheckDetail ?? {};
  const record = kvTable(
    [
      ['Chain', escapeHtml(provenance.chainName)],
      ['Read from', `<code class="sc-mono">${escapeHtml(provenance.endpoint)}</code>`],
      ['At block', `<span class="sc-num">${formatInt(provenance.generatedAtBlock)}</span>`],
      ['Generated', `<span title="${escapeHtml(provenance.generatedAt)}">${escapeHtml(formatUtc(provenance.generatedAt))}</span>`],
      [
        'Blocks scanned',
        cell(`<span class="sc-num">${formatInt(provenance.scannedToBlock)} to ${formatInt(provenance.scannedFromBlock)}</span>`, provenance.scanStoppedBecause ? caption(provenance.scanStoppedBecause) : ''),
      ],
      ['Messages in those blocks', `<span class="sc-num">${formatInt(provenance.messagesSeenInWindow ?? rows.length)}</span>`],
      ['Genesis hash', `<code class="sc-full">${escapeHtml(provenance.genesisHash)}</code>`],
      ['Runtime version', `<span class="sc-num">${formatInt(provenance.specVersion)}</span>`],
      ['Tool', cell(`<code class="sc-mono">${escapeHtml(provenance.tool)}</code>`, caption('Read-only: it signs nothing and submits nothing.'))],
      ['Operator key check', cell(`<span>${escapeHtml(summary.selfCheck)}</span>`, detail.method ? caption(`${detail.method}.`) : '')],
      ['Explorer', explorer.indexesThisChain ? link({ href: explorer.base, text: 'These messages are in the explorer' }) : escapeHtml(explorer.note)],
      ['Record file', link({ href: '/oversight-sample.json', text: 'oversight-sample.json (download)', download: 'oversight-sample.json' })],
    ],
    { caption: 'The record' },
  );

  // ── the five figures ──────────────────────────────────────────────────────
  const total = summary.rows ?? rows.length;
  const figures = stats(
    [
      ...FIGURES.map(([key, label, cap]) => ({
        key,
        label,
        caption: cap,
        value:
          key === 'selfCheck'
            ? `${formatInt(detail.keysMatched ?? 0)} of ${formatInt(detail.keysPublishedOnChain ?? 0)}`
            : `${formatInt(summary[key])} of ${formatInt(total)}`,
      })),
      { key: RECHECK[0], label: RECHECK[1], caption: RECHECK[2], value: null },
    ],
    { label: 'Summary of the record' },
  );

  // ── how to read this ──────────────────────────────────────────────────────
  const howToRead = kvTable(
    HOW_TO_READ.map(([term, text]) => [term, escapeHtml(text)]),
    { caption: 'How to read this' },
  );

  // ── contents and the groups ───────────────────────────────────────────────
  const toc = `<nav class="ov-toc sc-prose" aria-labelledby="toc-h">
  <h3 class="sc-h3" id="toc-h">Contents</h3>
  <ul>
${shown.map((g) => `    <li><a href="#${escapeHtml(g.id)}">${escapeHtml(g.title)}</a> <span class="sc-muted">(${formatInt(g.rows.length)})</span></li>`).join('\n')}
    <li><a href="#${ALL_GROUP.id}">${escapeHtml(ALL_GROUP.title)}</a> <span class="sc-muted">(${formatInt(rows.length)})</span></li>
  </ul>
</nav>`;
  const groupsHtml = [
    ...shown.map((g) => group({ ...g, columns: MESSAGE_COLUMNS, rowsHtml: g.rows.map((r) => messageRow(r, { explorer, recheck })) })),
    group({
      ...ALL_GROUP,
      intro: 'Every message in the record, with the group it is shown in.',
      rows: inBlockOrder,
      columns: INDEX_COLUMNS,
      rowsHtml: inBlockOrder.map((r) => indexRow(r, groupOf)),
      className: 'ov-table ov-index',
    }),
  ].join('\n');

  const body = `<div class="sc-container">
  <div class="sc-page-head">
    <h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
${rows.length === 40 ? `    <p class="sc-lead">${escapeHtml(STANDFIRST)}</p>\n` : ''}  </div>
  <div class="sc-reading sc-prose">
${EXPLANATION.map((sentence) => `    <p>${sentence}</p>`).join('\n')}
  </div>
  <noscript><div class="ov-noscript">${callout({ variant: 'warning', body: 'JavaScript is off, so the hash check did not run in this browser. Every field below is shown exactly as the read-only tool recorded it.' })}</div></noscript>
  <p class="sc-sr" aria-live="polite" data-announce></p>
</div>
${section({ id: 'record', title: 'The record', intro: 'One read of a chain by a read-only tool, checked in with this site.', body: `<div class="ov-notes">${notes}</div>${record}` })}
${section({ id: 'summary', title: 'Summary', body: figures })}
${section({ id: 'how-to-read', title: 'How to read this', body: howToRead })}
${section({ id: 'messages', title: 'The messages', intro: 'Grouped by what the operator could do with each message. The last group lists every message in block order.', body: `${toc}\n<div class="ov-groups">\n${groupsHtml}\n</div>` })}`;

  return page({ title: TITLE, description: DESCRIPTION, path: '/oversight', current: null, facts, builtAt, body, css, scripts });
}
