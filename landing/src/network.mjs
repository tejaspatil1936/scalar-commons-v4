// Renders /network (SITE-REDESIGN.md §5.2): the one live page, replacing the
// Observatory and Pulse. Every figure the build knows — read off the node into
// chain-facts.json — is printed here, so the page is whole with scripts off;
// the rest arrive in the reader's browser (src/network/main.js), which reads
// the public node and the indexer every 12 s while the tab is visible and
// replaces each value in place. Nothing on the page is typed: every count,
// block, date and hash is a parameter from chain-facts.json,
// runtime-history.json, status.json or posture.json.
import {
  EXPLORER_ORIGIN,
  RPC_WSS,
  API_V1,
  badge,
  button,
  chips,
  escapeHtml,
  kvTable,
  page,
  section,
  skeleton,
  stats,
  table,
} from './chrome/templates.mjs';
import { CHIPS, bps, cmn, cmnExact, cmnShort, day, duration, int, utc } from './network/model.js';

export const TITLE = 'Network';
export const INTRO = 'Live figures read from the public node and the indexer. Every figure names its source at the bottom of the page.';
export const DESCRIPTION = 'Live figures from the Scalar Commons testnet: blocks, validators, agent activity, emissions and agents, each with its source.';
/** How many blocks the Recent blocks table shows, and how many headers the Validators table counts authorship over. */
export const RECENT = 12;
export const AUTHORSHIP_WINDOW = 60;
/** How many agent events the Activity table reads. */
export const ACTIVITY_LIMIT = 25;

/** A value the build could not know: a skeleton while the script reads it, words when there is no script. */
export const pending = (width = '6ch') => `${skeleton(width)}<span class="net-nojs">Needs JavaScript</span>`;
/**
 * A table only the browser can fill: loading bars while the script reads it,
 * and, with scripts off, one sentence in their place (the noscript rule in
 * renderNetwork hides the bars' rows and the header, as an empty table does).
 */
function liveTable(opts, rowCount, nojs) {
  const rows = Array.from({ length: rowCount }, () => opts.columns.map(() => skeleton('100%')));
  return table({ ...opts, rows }).replace('</tbody>', `<tr class="net-nojs-row"><td class="sc-empty-cell" colspan="${opts.columns.length}">${escapeHtml(nojs)}</td></tr></tbody>`);
}

/** The figures of chain-facts.json the page prints, derived once. */
export function buildFigures(facts) {
  const p = facts.provenance;
  const s = facts.state;
  const c = facts.constants;
  const blockMs = Number(c.babe.expectedBlockTime);
  const eraBlocks = Number(c.emissions.eraDuration);
  const nextSettlement = s.eraStartBlock + eraBlocks;
  const remaining = Math.max(0, nextSettlement - p.readAtBlock);
  const settleAt = Date.parse(p.fetchedAt) + remaining * blockMs;
  const issued = BigInt(s.totalIssuancePlancks);
  const cap = BigInt(c.emissions.supplyCap);
  const pct = Number((issued * 10000n) / cap) / 100;
  return { p, s, c, blockMs, eraBlocks, nextSettlement, settleAt, issued, cap, pct, eraHours: (eraBlocks * blockMs) / 3_600_000, hourBlocks: Math.round(3_600_000 / blockMs) };
}

const explorer = (path) => `${EXPLORER_ORIGIN}${path}`;
const blockLink = (n) => `<a class="sc-num" href="${escapeHtml(explorer(`/block/${n}`))}">${int(n)}</a>`;

/** The rows of "How these figures are read": [key, figure, source HTML]. */
export const SOURCES = [
  ['height', 'Block height', '<code>chain_getHeader</code> on the node'],
  ['finalized', 'Finalized', '<code>chain_getFinalizedHead</code> on the node'],
  ['validators', 'Validators', '<code>session.validators</code>, <code>staking.validatorCount</code>'],
  ['era', 'Era and next settlement', '<code>agents.eraNumber</code>, <code>emissions.eraStartBlock</code>, <code>emissions.EraDuration</code>'],
  ['agents', 'Registered agents', '<code>agents.counterForAgentStake</code>'],
  ['agentList', 'Operator-run, active, newest agents', 'Indexer <code>/v1/agents</code>'],
  ['escrows', 'Open disputes, agents in dispute', 'Indexer <code>/v1/escrows</code>; at build, every agreement in <code>escrow.agreements</code>'],
  ['agreements', 'Open agreements', '<code>escrow.activeAgreementCount</code>'],
  ['messages', 'Messages sent', 'Indexer <code>/v1/events?section=messages&amp;method=MessageSent</code>'],
  ['authors', 'Validators table, recent blocks', '<code>session.queuedKeys</code>, <code>babe.authorities</code>, <code>chain_getBlock</code>, <code>chain_getHeader</code>'],
  ['activity', 'Activity', 'Indexer <code>/v1/activity</code>'],
  ['issued', 'Issued so far', '<code>balances.totalIssuance</code>'],
  ['cap', 'Supply cap and era parameters', 'Runtime constants (<code>emissions.SupplyCap</code> and others), read with the metadata'],
  ['lastEmission', 'Last era emission', '<code>emissions.lastEraEmission</code>'],
  ['fee', 'Completion fee', '<code>autoParams.completionFeeBps</code>'],
  ['slashes', 'Slashed last hour', 'Indexer <code>/v1/events?section=agents&amp;method=SlashExecuted</code>'],
];
/** Figures the build reads (chain-facts.json); the rest have no value until the browser reads them. */
export const BUILT = new Set(['height', 'finalized', 'validators', 'era', 'agents', 'escrows', 'issued', 'cap', 'fee']);

export function renderNetwork({ facts, history, status, posture, css, builtAt }) {
  const f = buildFigures(facts);
  const { p, s, c } = f;
  const dec = facts.token.decimals;
  const sym = facts.token.symbol;
  const atBuild = `At block ${int(p.readAtBlock)}, when this page was built`;
  const config = {
    decimals: dec,
    symbol: sym,
    ss58: p.ss58Format,
    timestampPallet: facts.pallets.find((x) => x.name === 'timestamp')?.index ?? null,
    eraBlocks: f.eraBlocks,
    blockMs: f.blockMs,
    grace: Number(c.agents.heartbeatGracePeriod),
    supplyCap: c.emissions.supplyCap,
    hourBlocks: f.hourBlocks,
    recent: RECENT,
    window: AUTHORSHIP_WINDOW,
    activityLimit: ACTIVITY_LIMIT,
    builtAtBlock: p.readAtBlock,
    builtAt: p.fetchedAt,
    explorer: EXPLORER_ORIGIN,
    rpc: RPC_WSS,
    api: API_V1,
  };

  const head = `<div class="sc-container sc-page-head"><h1 class="sc-h1">${escapeHtml(TITLE)}</h1><p class="sc-lead">${escapeHtml(INTRO)}</p></div>`;

  // 1 · Status
  const statusBody = `<div class="net-alert" data-alert></div>
${stats(
  [
    { key: 'height', label: 'Block height', value: int(p.readAtBlock), caption: '' },
    { key: 'finalized', label: 'Finalized', value: int(p.finalizedAtRead), caption: '' },
    { key: 'validators', label: 'Validators', value: int(s.validators), caption: `of ${int(s.validatorCount)} seats` },
    { key: 'era', label: 'Era (reward period)', value: int(s.eraNumber), caption: `${int(s.eraElapsedBlocks)} / ${int(f.eraBlocks)} blocks` },
    { key: 'agents', label: 'Registered agents', value: int(s.registeredAgents), caption: `${int(s.operatorRunAgents)} operator-run` },
    { key: 'disputes', label: 'Open disputes', value: int(s.openDisputes), caption: `Counted at block ${int(p.readAtBlock)}` },
    { key: 'agreements', label: 'Open agreements', value: pending(), caption: '' },
    { key: 'messages', label: 'Messages sent', value: pending(), caption: '' },
  ],
  { id: 'status-stats', label: 'Network status' },
)}
<p class="sc-stats-foot" data-updated>${escapeHtml(`${atBuild}, ${utc(p.fetchedAt)}.`)}</p>`;

  // 2 · Validators
  const hosts = status?.fields?.hosts;
  const validatorsBody = `${liveTable(
    {
      id: 'validators-table',
      caption: 'Validators',
      columns: [{ label: '#', align: 'right' }, { label: 'Account' }, { label: 'Status' }, { label: 'Blocks authored', align: 'right' }, { label: 'Last block', align: 'right' }],
    },
    Math.max(1, Math.min(s.validators, 3)),
    'The validator list is read in your browser and needs JavaScript.',
  )}
<p class="sc-stats-foot" data-window>Blocks authored and last block count the most recent block headers the page reads.</p>
${hosts ? `<p class="sc-stats-foot net-record" data-status="hosts">${escapeHtml(hosts.value)} (Operator’s record, as of ${escapeHtml(day(hosts.asOf))}.)</p>` : ''}`;

  // 3 · Recent blocks
  const recentRows = (s.recentBlocks ?? []).slice(0, RECENT).map((b) => [blockLink(b.number), pending(), pending('12ch'), int(b.extrinsics), b.final ? badge('Finalized') : badge('Pending')]);
  const blocksBody = `${table({
    id: 'blocks-table',
    caption: 'Recent blocks',
    columns: [{ label: 'Block' }, { label: 'Age' }, { label: 'Author' }, { label: 'Extrinsics', align: 'right' }, { label: 'Finalized' }],
    rows: recentRows,
    empty: 'No blocks read yet.',
  })}
<div class="net-more">${button({ text: 'Open in explorer', href: explorer('/blocks'), variant: 'text' })}</div>`;

  // 4 · Activity
  const activityBody = `${chips(CHIPS.map((ch) => ({ label: ch.label, value: ch.value || 'all', current: ch.value === '' })), { label: 'Filter agent events' })}
${liveTable(
  { id: 'activity-table', caption: 'Agent events in the last hour', columns: [{ label: 'Time' }, { label: 'Event' }, { label: 'Agents' }, { label: 'Details' }] },
  1,
  'Agent events are read in your browser and need JavaScript.',
)}
<div class="net-more">${button({ text: 'All agent activity in the explorer', href: explorer('/activity'), variant: 'text' })}</div>`;

  // 5 · Emissions
  const settleCaption = `≈ ${utc(f.settleAt)}`;
  const paramRows = [
    ['Era length', `${int(f.eraBlocks)} blocks (${duration((f.eraBlocks * f.blockMs) / 1000)})`],
    ['Era started at block', `<span data-param="eraStart">${blockLink(s.eraStartBlock)}</span>`],
    ['Emission per era at launch', escapeHtml(cmn(c.emissions.initialEmissionsPerEra, dec, sym))],
    ['Minimum emission per era (when an agent qualifies)', escapeHtml(cmn(c.emissions.floorEmissionPerEra, dec, sym))],
    ['Target emission per agent', escapeHtml(cmn(c.emissions.targetEmissionPerAgent, dec, sym))],
    ['Minimum era volume to qualify', escapeHtml(cmn(c.emissions.minQualifyingVol, dec, sym))],
    ['Velocity bonus, at most', escapeHtml(`+${bps(c.emissions.velocityBonusBps)}`)],
    ['Oracle accuracy bonus, at most', escapeHtml(`+${bps(c.emissions.oracleBonusBps)}`)],
    ['Completion fee on confirmed work', `<span data-param="fee">${escapeHtml(bps(s.completionFeeBps))}</span>`],
  ];
  const emissionsBody = `${stats(
    [
      { key: 'issued', label: `Issued so far (${sym})`, value: `<span title="${escapeHtml(cmnExact(f.issued, dec, sym))}">${escapeHtml(cmnShort(f.issued, dec, ''))}</span>`, caption: `${f.pct} % of the cap` },
      { key: 'cap', label: `Supply cap (${sym})`, value: `<span title="${escapeHtml(cmnExact(f.cap, dec, sym))}">${escapeHtml(cmnShort(f.cap, dec, ''))}</span>`, caption: 'Fixed in the runtime' },
      { key: 'lastEmission', label: `Last era emission (${sym})`, value: pending(), caption: '' },
      { key: 'settlement', label: 'Next settlement (block)', value: int(f.nextSettlement), caption: escapeHtml(settleCaption) },
    ],
    { id: 'emissions-stats', label: 'Emissions' },
  )}
<h3 class="sc-h3 net-sub">This era’s parameters</h3>
${kvTable(paramRows, { caption: 'This era’s parameters' })}`;

  // 6 · Agents
  const agentsBody = `${stats(
    [
      { key: 'registered', label: 'Registered', value: int(s.registeredAgents), caption: atBuild.replace(', when this page was built', '') },
      { key: 'active', label: 'Active (heartbeat within grace)', value: pending(), caption: `A heartbeat in the last ${int(c.agents.heartbeatGracePeriod)} blocks` },
      { key: 'inDispute', label: 'In dispute', value: pending(), caption: '' },
      { key: 'slashed', label: 'Slashed last hour', value: pending(), caption: '' },
    ],
    { id: 'agents-stats', label: 'Agents' },
  )}
<h3 class="sc-h3 net-sub">Most recently registered</h3>
${liveTable(
  {
    id: 'agents-table',
    caption: 'The most recently registered agents',
    columns: [{ label: 'Name or address' }, { label: 'Registered at block', align: 'right' }, { label: 'Operator-run' }, { label: 'Status' }],
  },
  1,
  'The agent list is read in your browser and needs JavaScript.',
)}`;

  // 7 · Runtime history
  const historyRows = (history?.upgrades ?? [])
    .slice()
    .sort((a, b) => b.specVersion - a.specVersion)
    .map((u) => [escapeHtml(u.specVersion), u.appliedAtBlock ? blockLink(u.appliedAtBlock) : '', escapeHtml(u.date ? day(u.date) : ''), escapeHtml(u.summary)]);
  const historyBody = table({
    caption: 'Runtime upgrades',
    columns: [{ label: 'Spec' }, { label: 'Block', align: 'right' }, { label: 'Date' }, { label: 'Note' }],
    rows: historyRows,
    empty: 'No upgrades are recorded.',
    className: 'net-history',
  });

  // 8 · How these figures are read
  const builtCell = escapeHtml(`Block ${int(p.readAtBlock)}, ${utc(p.fetchedAt)} (build)`);
  const sourceRows = SOURCES.map(([key, figure, source]) => [escapeHtml(figure), source, `<span data-read="${key}">${BUILT.has(key) ? builtCell : pending('14ch')}</span>`]);
  sourceRows.push(['Runtime history', '<code>runtime-history.json</code>, checked against the chain when written', escapeHtml('Checked-in record')]);
  if (status) sourceRows.push(['Who runs the validators', '<a href="status.json" download="status.json">status.json (download)</a>', escapeHtml(`Operator’s record, updated ${day(status.updated)}`)]);
  if (posture) sourceRows.push(['Security posture', '<a href="posture.json" download="posture.json">posture.json (download)</a>', escapeHtml(`Operator’s record, updated ${day(posture.updated)}`)]);
  const sourcesBody = `${table({
    id: 'sources-table',
    caption: 'How these figures are read',
    columns: [{ label: 'Figure' }, { label: 'Source' }, { label: 'Last read' }],
    rows: sourceRows,
  })}
<p class="sc-stats-foot">The node is <code>${escapeHtml(RPC_WSS)}</code>; the indexer is <code>${escapeHtml(API_V1)}</code>.</p>`;

  const body = `${head}
${section({ id: 'status', title: 'Status', body: statusBody })}
${section({ id: 'validators', title: 'Validators', intro: 'Validators produce and finalize blocks. Active ones are in the current set; queued ones join it when the set next changes.', body: validatorsBody })}
${section({ id: 'blocks', title: 'Recent blocks', body: blocksBody })}
${section({ id: 'activity', title: 'Activity', intro: 'What agents did in the last hour, newest first.', body: activityBody })}
${section({ id: 'emissions', title: 'Emissions', intro: `New ${escapeHtml(sym)} is minted once per era (the ${escapeHtml(String(f.eraHours))}-hour reward period), only for verified work, and never beyond the supply cap.`, body: emissionsBody })}
${section({ id: 'agents', title: 'Agents', intro: 'Agents stake CMN to register and send heartbeats to show they are running. Operator-run agents are the ones the testnet’s operator runs.', body: agentsBody })}
${section({ id: 'runtime', title: 'Runtime history', body: historyBody })}
${section({ id: 'sources', title: 'How these figures are read', body: sourcesBody })}
<script type="application/json" id="net-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`;

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
    extraHead: '\n<noscript><style>.sc-skeleton,.sc-skeleton+.sc-sr{display:none}.net-nojs{display:inline}tbody:has(.net-nojs-row) tr:not(.net-nojs-row),table:has(.net-nojs-row) thead{display:none}.net-nojs-row{display:table-row}#activity .sc-chips{display:none}</style></noscript>',
  });
}

/** A retired address: a meta refresh to its new home and a visible link to it. */
export function renderRedirect({ title, to, label, facts, css, builtAt }) {
  const body = `<div class="sc-container sc-page-head"><h1 class="sc-h1">${escapeHtml(title)} has moved</h1><p class="sc-lead">This page is now part of the Network page.</p><p>${button({ text: `Go to ${label}`, href: to, variant: 'primary' })}</p></div>`;
  return page({
    title,
    description: `${title} is now part of the Network page.`,
    path: to.split('#')[0],
    facts,
    builtAt,
    body,
    css,
    extraHead: `\n<meta http-equiv="refresh" content="0; url=${escapeHtml(to)}">\n<meta name="robots" content="noindex">`,
  });
}
