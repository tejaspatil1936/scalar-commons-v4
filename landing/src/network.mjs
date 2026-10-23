// /network — the one live page (SITE-REDESIGN.md §5.2). This module renders
// the frame at build time: the eight sections, every figure a skeleton the
// size of the value it stands for, the runtime history from its checked-in
// record, and the sources table that names where each figure is read from.
// src/network/main.js (bundled to network.js) fills every figure from the
// public node and the indexer; nothing here types a chain figure.
import { API_V1, RPC_WSS, button, chips, escapeHtml, formatDate, formatInt, kvTable, link, page, section, skeleton, stats, table } from './chrome/templates.mjs';
import { ACTIVITY_ROWS, AGENT_ROWS, BLOCK_ROWS, BLOCK_WINDOW, EXPLORER_ORIGIN } from './network/data.js';
import { KINDS } from './network/events.js';
import { BLOCKS_PER_HOUR, OPERATOR_PREFIX } from './network/model.js';
import { COLUMNS, historyRow, note, skeletonRows } from './network/rows.js';

export const TITLE = 'Network';
export const DESCRIPTION = 'Live figures from the Scalar Commons public testnet: blocks, validators, agents, agreements, disputes, emissions and the runtime history, each with its source.';
export const INTRO = 'Live figures read from the public node and the indexer. Every figure names its source at the bottom of the page.';

/** The eight sections, in order: id and title. The tests hold the page to these. */
export const SECTIONS = [
  ['status', 'Status'],
  ['validators', 'Validators'],
  ['blocks', 'Recent blocks'],
  ['activity', 'Activity'],
  ['emissions', 'Emissions'],
  ['agents', 'Agents'],
  ['history', 'Runtime history'],
  ['sources', 'How these figures are read'],
];

/** The status row's eight stats, in order: key, label, and whether the caption starts as a skeleton. */
export const STATUS_STATS = [
  { key: 'height', label: 'Block height' },
  { key: 'finalized', label: 'Finalized' },
  { key: 'validators', label: 'Validators', caption: true },
  { key: 'era', label: 'Era', caption: true },
  { key: 'agents', label: 'Registered agents', caption: true },
  { key: 'disputes', label: 'Open disputes' },
  { key: 'agreements', label: 'Open agreements' },
  { key: 'messages', label: 'Messages sent' },
];
export const EMISSION_STATS = [
  { key: 'issued', label: 'Issued so far' },
  { key: 'cap', label: 'Supply cap' },
  { key: 'lastEra', label: 'Last era emission' },
  { key: 'settlement', label: 'Next settlement', caption: true },
];
export const AGENT_STATS = [
  { key: 'registered', label: 'Registered' },
  { key: 'active', label: 'Active', caption: true },
  { key: 'inDispute', label: 'In dispute' },
  { key: 'slashedHour', label: 'Slashed last hour' },
];
/** The era in progress and its parameters, as /v1/eras/current and /v1/emissions report them: key, label. */
export const ERA_PARAMS = [
  ['era', 'Era in progress'],
  ['startBlock', 'Started at block'],
  ['lastSettledEra', 'Last settled era'],
  ['eraDurationBlocks', 'Era length'],
  ['initialEmissionPerEraPlancks', 'Initial emission per era'],
  ['floorEmissionPerEraPlancks', 'Floor emission per era'],
  ['targetEmissionPerAgentPlancks', 'Target emission per agent'],
  ['velocityBonusBps', 'Velocity bonus, at most'],
  ['oracleBonusBps', 'Oracle bonus'],
  ['minQualifyingVolumePlancks', 'Minimum qualifying volume per era'],
  ['unitVolumePlancks', 'Unit of volume'],
];

/** The sources table: figure, where it is read from, and the read key the script stamps a last-read time on. */
export const SOURCE_ROWS = (facts) => [
  ['Block height', 'chain_subscribeNewHeads, pushed by the node; /v1/status while the socket is down', 'newHeads'],
  ['Finalized', 'chain_subscribeFinalizedHeads; /v1/status while the socket is down', 'finalizedHeads'],
  ['Validators', 'Session.Validators, Session.QueuedKeys and Babe.Authorities; seats from Staking.ValidatorCount', 'validators'],
  ['Era', '/v1/eras/current', 'era'],
  ['Registered agents', `/v1/agents; operator-run means the on-chain name starts with “${OPERATOR_PREFIX}”`, 'agents'],
  ['Open disputes', '/v1/events: escrow.DisputeOpened less escrow.DisputeResolved for the same agreement, over the index', 'disputes'],
  ['Open agreements', '/v1/escrows/stats, activeAgreementCount', 'escrowStats'],
  ['Messages sent', '/v1/events, the total of messages.MessageSent over the index', 'messagesSent'],
  ['Recent blocks', `/v1/blocks for the first rows, then chain_subscribeNewHeads; the author is decoded from each header’s BABE pre-digest; blocks authored counts the last ${formatInt(BLOCK_WINDOW)} blocks read`, 'blocks'],
  ['Activity', `/v1/activity, the last ${formatInt(BLOCKS_PER_HOUR)} blocks the index holds`, 'activity'],
  ['Issued so far, supply cap', '/v1/emissions/supply', 'supply'],
  ['Last era emission, era parameters', '/v1/emissions', 'emissions'],
  ['Next settlement', '/v1/eras/current', 'era'],
  ['Agents active', `/v1/agents, a heartbeat within the last ${formatInt(facts.constants.agents.heartbeatGracePeriod)} blocks (the grace period)`, 'agents'],
  ['Agents in dispute', 'the open disputes above; each party counted once', 'disputes'],
  ['Slashed last hour', `/v1/events, agents.SlashExecuted in the last ${formatInt(BLOCKS_PER_HOUR)} blocks the index holds`, 'slashes'],
];

/** The facts the script needs that are not on the wire: the block time, the heartbeat grace, the token's decimals. */
export function embeddedFacts(facts) {
  const out = {
    blockMs: Number(facts.constants.babe.expectedBlockTime),
    heartbeatGrace: Number(facts.constants.agents.heartbeatGracePeriod),
    decimals: Number(facts.token.decimals),
    symbol: String(facts.token.symbol),
    specVersion: Number(facts.provenance.specVersion),
  };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'number' && !(value > 0)) throw new Error(`chain-facts.json has no ${key} for the network page`);
  }
  return out;
}

const statRow = (items, id) =>
  stats(
    items.map((s) => ({ key: s.key, label: s.label, value: skeleton('7ch'), caption: s.caption ? skeleton('9ch') : '' })),
    { id },
  );
const skeletonTable = (name, n, widths, caption) => table({ columns: COLUMNS[name], rows: skeletonRows(COLUMNS[name], n, widths), id: `${name}-table`, caption });
const textButton = (text, href) => `<p class="sc-actions">${button({ text, href, variant: 'text' })}</p>`;
const stack = (...parts) => `<div class="sc-stack">${parts.join('')}</div>`;

/**
 * The page. `history` is runtime-history.json; `status` and `posture` the
 * operator records (only their dates are printed; the files are linked for
 * download). `css` is the chrome, inlined.
 */
export function renderNetwork({ facts, history, status, posture, builtAt, css }) {
  const embedded = embeddedFacts(facts);
  const validatorsKnown = Number(facts.state?.validators) || 1;
  const upgrades = [...history.upgrades].sort((a, b) => b.appliedAtBlock - a.appliedAtBlock);
  const titles = Object.fromEntries(SECTIONS);

  const bodies = {
    // The script puts the one warning callout first in this stack when a read fails, and removes it when the read succeeds again.
    status: stack(statRow(STATUS_STATS, 'status-stats'), '<p class="sc-stats-foot" data-updated>Waiting for the first read.</p>'),
    validators: skeletonTable('validators', validatorsKnown, ['10ch', '14ch', '5ch', '2ch', '9ch'], 'Validators'),
    blocks: stack(skeletonTable('blocks', BLOCK_ROWS, ['9ch', '6ch', '14ch', '2ch', '7ch'], 'Recent blocks'), textButton('Open in explorer', `${EXPLORER_ORIGIN}/blocks`)),
    activity: `${chips(KINDS.map((k, i) => ({ label: k.label, value: k.value, current: i === 0 })), { label: 'Filter events' })}${stack(
      skeletonTable('activity', 5, ['7ch', '12ch', '14ch', '16ch'], 'Agent events'),
      textButton('All activity in the explorer', `${EXPLORER_ORIGIN}/activity`),
    )}`,
    emissions: stack(
      statRow(EMISSION_STATS, 'emission-stats'),
      kvTable(
        ERA_PARAMS.map(([key, label]) => [label, `<span data-param="${escapeHtml(key)}">${skeleton('8ch')}</span>`]),
        { caption: 'Era parameters' },
      ),
    ),
    agents: stack(statRow(AGENT_STATS, 'agent-stats'), skeletonTable('agents', AGENT_ROWS, ['14ch', '9ch', '5ch', '6ch'], 'Recently registered agents')),
    history: table({ columns: COLUMNS.history, rows: upgrades.map(historyRow), id: 'history-table', caption: 'Runtime upgrades' }),
    sources: table({
      columns: COLUMNS.sources,
      id: 'sources-table',
      caption: 'Sources',
      rows: [
        ...SOURCE_ROWS(facts).map(([figure, source, key]) => [escapeHtml(figure), note(source), `<span data-read="${escapeHtml(key)}">${skeleton('12ch')}</span>`]),
        ['Runtime history', link({ href: 'runtime-history.json', text: 'runtime-history.json (download)', download: 'runtime-history.json' }), escapeHtml(`Record; last entry ${formatDate(`${upgrades[0].date}T00:00:00Z`)}`)],
        ['Validator hosts', link({ href: 'status.json', text: 'status.json (download)', download: 'status.json' }), escapeHtml(`Operator record, updated ${formatDate(`${status.updated}T00:00:00Z`)}`)],
        ['Security posture', link({ href: 'posture.json', text: 'posture.json (download)', download: 'posture.json' }), escapeHtml(`Operator record, updated ${formatDate(`${posture.updated}T00:00:00Z`)}`)],
      ],
    }),
  };
  const intros = {
    status: 'The chain as the page reads it now.',
    validators: 'The active set, read from the node, and which of them authored the latest blocks.',
    blocks: `The last ${formatInt(BLOCK_ROWS)} blocks, newest first; a new block replaces the oldest row.`,
    activity: `What the agents did in the last hour (${formatInt(BLOCKS_PER_HOUR)} blocks), newest first, at most ${formatInt(ACTIVITY_ROWS)} events.`,
    emissions: 'What the emissions pallet has issued, and the parameters of the era (the reward period) in progress.',
    agents: `Every registered agent counted, and the ${formatInt(AGENT_ROWS)} most recently registered listed.`,
    history: 'Every runtime upgrade applied to the public testnet, from the checked-in record.',
    sources: `Indexer routes are under ${API_V1}; storage items and RPC methods are read from the public node at ${RPC_WSS}. The last read names the block a figure is from and when it was read.`,
  };

  const body = `<div class="sc-container sc-page-head"><h1 class="sc-h1">${escapeHtml(TITLE)}</h1><p class="sc-lead">${escapeHtml(INTRO)}</p></div>
${SECTIONS.map(([id]) => section({ id, title: titles[id], intro: escapeHtml(intros[id]), body: bodies[id] })).join('\n')}`;

  return page({
    title: TITLE,
    description: DESCRIPTION,
    path: '/network',
    current: 'network',
    facts,
    builtAt,
    body,
    css,
    scripts: ['network.js'],
    extraHead: `\n<script type="application/json" id="network-facts">${JSON.stringify(embedded)}</script>`,
  });
}

/** A redirect stub for a retired URL: meta refresh, one sentence and a link. No chrome. */
export function renderRedirect({ to, title }) {
  const canonical = `https://scalarnet.io${to.replace(/#.*$/, '')}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=${escapeHtml(to)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<title>${escapeHtml(title)} — Scalar Commons</title>
</head>
<body>
<p>This page has moved to <a href="${escapeHtml(to)}">${escapeHtml(title)}</a>.</p>
</body>
</html>
`;
}
