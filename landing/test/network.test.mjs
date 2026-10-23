// /network (SITE-REDESIGN.md §5.2) and the two redirect pages that replace
// /observatory and /pulse. The page's structure is held to the brief section
// by section; every link in <main> goes to a page that exists; no figure is
// typed into the page (two renders from different data share no figure); the
// Observatory's audit findings (Appendix A, 17–22) stay false; and the pure
// helpers the browser script uses are held to their inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderNetwork, renderRedirect, TITLE, INTRO, SOURCES } from '../src/network.mjs';
import { REDIRECTS } from '../scripts/pages/redirects.mjs';
import * as M from '../src/network/model.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const facts = readJson('../chain-facts.json');
const history = readJson('../runtime-history.json');
const status = readJson('../public/status.json');
const posture = readJson('../public/posture.json');
const builtAt = '2026-10-23T20:00:00.000Z';
const html = renderNetwork({ facts, history, status, posture, css: '', builtAt });
const main = html.match(/<main id="main">([\s\S]*)<\/main>/)[1];
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');

test('one h1 "Network", the intro sentence, the head the chrome gives every page', () => {
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(main, new RegExp(`<h1 class="sc-h1">${TITLE}</h1><p class="sc-lead">${INTRO.replace(/\./g, '\\.')}</p>`));
  assert.equal(INTRO, 'Live figures read from the public node and the indexer. Every figure names its source at the bottom of the page.');
  assert.match(html, /<title>Network — Scalar Commons<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/);
  assert.match(html, /<nav class="sc-nav"[^>]*>[\s\S]*href="\/network" aria-current="page">Network/);
  assert.match(html, /<script type="module" src="network\.js"><\/script>/);
  assert.equal((html.match(/<script type="module"/g) ?? []).length, 1, 'one script');
});

test('the eight sections, in the brief’s order, each a <section> with an <h2>', () => {
  const sections = [...main.matchAll(/<section class="sc-section" id="([^"]+)"[^>]*><div class="sc-container"><div class="sc-section-head"><h2 class="sc-h2"[^>]*>([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(sections, [
    ['status', 'Status'],
    ['validators', 'Validators'],
    ['blocks', 'Recent blocks'],
    ['activity', 'Activity'],
    ['emissions', 'Emissions'],
    ['agents', 'Agents'],
    ['runtime', 'Runtime history'],
    ['sources', 'How these figures are read'],
  ]);
});

const statLabels = (id) => [...(main.match(new RegExp(`<div class="sc-stats" id="${id}"[\\s\\S]*?</div></div>(?!<div class="sc-stat")`))?.[0] ?? '').matchAll(/sc-stat-label">([^<]+)</g)].map((m) => m[1]);

test('status: eight stats in two rows of four, "Updated" under them, a place for the warning callout above', () => {
  assert.deepEqual(statLabels('status-stats'), ['Block height', 'Finalized', 'Validators', 'Era (reward period)', 'Registered agents', 'Open disputes', 'Open agreements', 'Messages sent']);
  const section = main.match(/<section class="sc-section" id="status"[\s\S]*?<\/section>/)[0];
  assert.ok(section.indexOf('data-alert') < section.indexOf('sc-stats'), 'the callout sits above the row');
  assert.match(section, /<p class="sc-stats-foot" data-updated>/);
  // Build-time values are printed, so the page is whole with scripts off.
  assert.match(section, new RegExp(`data-stat="height"[\\s\\S]*?data-value>${M.int(facts.provenance.readAtBlock)}<`));
  assert.match(section, new RegExp(`data-stat="validators"[\\s\\S]*?data-value>${M.int(facts.state.validators)}<[\\s\\S]*?of ${M.int(facts.state.validatorCount)} seats`));
  assert.match(section, new RegExp(`${M.int(facts.state.operatorRunAgents)} operator-run`));
});

test('validators, recent blocks, activity: the tables, filter chips and explorer links the brief names', () => {
  assert.deepEqual([...main.match(/id="validators-table"[\s\S]*?<\/thead>/)[0].matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]), ['#', 'Account', 'Status', 'Blocks authored', 'Last block']);
  assert.deepEqual([...main.match(/id="blocks-table"[\s\S]*?<\/thead>/)[0].matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]), ['Block', 'Age', 'Author', 'Extrinsics', 'Finalized']);
  assert.equal((main.match(/id="blocks-table"[\s\S]*?<\/tbody>/)[0].match(/<tr>/g) ?? []).length - 1, Math.min(12, facts.state.recentBlocks.length), 'twelve recent blocks from the build');
  assert.deepEqual([...main.match(/id="activity-table"[\s\S]*?<\/thead>/)[0].matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]), ['Time', 'Event', 'Agents', 'Details']);
  assert.deepEqual([...main.matchAll(/class="sc-chip" data-filter="[^"]*" aria-pressed="(?:true|false)">([^<]+)</g)].map((m) => m[1]), ['All', 'Agreements', 'Disputes', 'Messages', 'Registrations', 'Slashes']);
  assert.match(main, /<section class="sc-section" id="activity"/);
  assert.match(main, /href="https:\/\/explorer\.scalarnet\.io\/activity"[^>]*>All agent activity in the explorer/);
  assert.match(main, /href="https:\/\/explorer\.scalarnet\.io\/blocks"[^>]*>Open in explorer/);
});

test('emissions and agents: the stats the brief lists, the era’s parameters as a two-column table, no curve', () => {
  assert.deepEqual(statLabels('emissions-stats'), ['Issued so far (CMN)', 'Supply cap (CMN)', 'Last era emission (CMN)', 'Next settlement']);
  assert.deepEqual(statLabels('agents-stats'), ['Registered', 'Active (heartbeat within grace)', 'In dispute', 'Slashed last hour']);
  assert.match(main, /<table class="sc-table sc-kv">[\s\S]*Era length/);
  assert.deepEqual([...main.match(/id="agents-table"[\s\S]*?<\/thead>/)[0].matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1]), ['Name or address', 'Registered at block', 'Operator-run', 'Status']);
  assert.ok(!/<canvas|<svg(?![^>]*class="sc-icon)/.test(main), 'no canvas and no drawing but the icon set');
});

test('runtime history from runtime-history.json; the sources table names every figure and links status.json and posture.json only there', () => {
  const rows = main.match(/class="sc-table net-history"[\s\S]*?<\/tbody>/)[0].match(/<tr>/g).length - 1;
  assert.equal(rows, history.upgrades.length);
  const sources = main.match(/id="sources-table"[\s\S]*?<\/tbody>/)[0];
  assert.deepEqual([...sources.matchAll(/<thead>[\s\S]*?<\/thead>/g)][0][0].match(/>([^<]+)<\/th>/g).map((t) => t.slice(1, -5)), ['Figure', 'Source', 'Last read']);
  for (const [key] of SOURCES) assert.match(sources, new RegExp(`data-read="${key}"`));
  for (const file of ['status.json', 'posture.json']) {
    assert.match(sources, new RegExp(`<a href="${file}" download="${file}">${file.replace('.', '\\.')} \\(download\\)</a>`));
    assert.equal((html.match(new RegExp(`href="[^"]*${file.replace('.', '\\.')}"`, 'g')) ?? []).length, 1, `${file} is linked once, from the sources table`);
  }
});

test('every link in <main> goes somewhere: the explorer’s routes, or a file the build publishes', () => {
  const hrefs = [...main.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 10);
  for (const href of hrefs) {
    assert.ok(href && href !== '#' && !href.startsWith('javascript:') && !href.startsWith('blob:'), `a link to nowhere: "${href}"`);
    if (href.startsWith('https://explorer.scalarnet.io')) assert.match(href, /^https:\/\/explorer\.scalarnet\.io\/(?:block\/\d+|account\/[1-9A-HJ-NP-Za-km-z]+|blocks|activity)$/);
    else assert.ok(['status.json', 'posture.json'].includes(href), `an unexpected link: ${href}`);
  }
  for (const file of ['../public/status.json', '../public/posture.json', '../runtime-history.json']) assert.ok(existsSync(new URL(file, import.meta.url)));
});

test('nothing is typed: a render from different data shares no figure with this one', () => {
  const bump = (v) => (typeof v === 'number' ? v + 100_003 : typeof v === 'string' && /^\d+$/.test(v) ? String(BigInt(v) * 3n + 7n) : v);
  const deep = (o) => (Array.isArray(o) ? o.map(deep) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : bump(o));
  const other = { ...facts, provenance: { ...facts.provenance, readAtBlock: facts.provenance.readAtBlock + 9_131, finalizedAtRead: facts.provenance.finalizedAtRead + 9_131, fetchedAt: '2027-03-14T05:06:00.000Z' }, state: deep(facts.state), constants: deep(facts.constants) };
  other.constants.emissions.supplyCap = String(BigInt(facts.constants.emissions.supplyCap) * 5n);
  const otherHistory = { ...history, upgrades: history.upgrades.map((u) => ({ ...u, specVersion: u.specVersion + 500, appliedAtBlock: u.appliedAtBlock + 77_777, date: '2027-01-26' })) };
  const day = (rec) => ({ ...rec, updated: '2027-02-27', fields: Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, { ...v, asOf: '2027-02-27' }])) });
  const html2 = renderNetwork({ facts: other, history: otherHistory, status: day(status), posture: day(posture), css: '', builtAt: '2027-03-14T05:06:00.000Z' });
  const main2 = html2.match(/<main id="main">([\s\S]*)<\/main>/)[1];
  // Route and storage names in <code> are names, not figures. A date (with its
  // time) is one figure, so a build at 21:27 does not collide with a record dated the 27th.
  const DATE = /\d{1,2} [A-Z][a-z]{2} \d{4}(?:, \d{2}:\d{2} UTC)?/g;
  const figures = (h) => {
    const t = text(h.replace(/<code>[\s\S]*?<\/code>/g, ' '));
    return new Set([...(t.match(DATE) ?? []), ...(t.replace(DATE, ' ').match(/\d[\d,.]*/g) ?? [])]);
  };
  const a = figures(main);
  const shared = [...figures(main2)].filter((f) => a.has(f));
  assert.deepEqual(shared, [], `figures that do not follow the data: ${shared.join(' ')}`);
  for (const word of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve']) {
    const outside = text(main.replace(/<p class="sc-stats-foot net-record"[\s\S]*?<\/p>/, ''));
    assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(outside), `"${word}" spelled out in the page`);
  }
});

test('Appendix A 17–22 stay false: no raw-response links, no zeros for unknowns, no instruments, no presenter, plain landmarks', () => {
  assert.ok(!/raw response|raw ↗|blob:|target="_blank"|≥/.test(html), 'no raw links, no new tabs, no "≥"');
  assert.ok(!/ember|validator ring|Present|Network graph|The same agents as a list|fullscreen|Pulse|Observatory/i.test(text(main)));
  // A figure the build could not know is a loading bar with words for scripts-off, never a zero.
  for (const key of ['agreements', 'messages', 'lastEmission', 'active', 'inDispute', 'slashed']) {
    assert.match(main, new RegExp(`data-stat="${key}"><span class="sc-stat-label">[^<]+</span><span class="sc-stat-value" data-value><span class="sc-skeleton"[^>]*></span><span class="sc-sr">Loading</span><span class="net-nojs">Needs JavaScript</span>`));
  }
  assert.match(html, /<noscript><style>[^<]*\.net-nojs\{display:inline\}/);
  // A table only the browser fills is one sentence with scripts off, not rows of repeated words;
  // and the filter chips, which do nothing without a script, are hidden then.
  for (const id of ['validators-table', 'activity-table', 'agents-table']) {
    const tbody = html.match(new RegExp(`id="${id}"[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`))[1];
    assert.ok(!/Needs JavaScript/.test(tbody), `${id}: no per-cell "Needs JavaScript"`);
    assert.match(tbody, /<tr class="net-nojs-row"><td class="sc-empty-cell" colspan="\d+">[^<]*needs? JavaScript\.<\/td><\/tr>$/);
  }
  assert.match(html, /<noscript><style>[^<]*tbody:has\(\.net-nojs-row\) tr:not\(\.net-nojs-row\),table:has\(\.net-nojs-row\) thead\{display:none\}\.net-nojs-row\{display:table-row\}#activity \.sc-chips\{display:none\}/);
  assert.equal((html.match(/<header\b/g) ?? []).length, 1, 'one banner');
  assert.ok(!/<aside\b/.test(html));
  // Every <li> sits in a list.
  const stripped = html.replace(/<(ul|ol)\b[\s\S]*?<\/\1>/g, '');
  assert.ok(!/<li\b/.test(stripped), 'an <li> outside any list');
});

test('/observatory and /pulse are redirect pages: a meta refresh and a visible link, in the plain chrome', () => {
  assert.deepEqual(REDIRECTS.map((r) => [r.file, r.to]), [['observatory.html', '/network'], ['pulse.html', '/network#activity']]);
  for (const r of REDIRECTS) {
    const page = renderRedirect({ ...r, facts, css: '', builtAt });
    assert.match(page, new RegExp(`<meta http-equiv="refresh" content="0; url=${r.to}">`));
    assert.match(page, new RegExp(`<a class="sc-btn sc-btn-primary" href="${r.to}">Go to ${r.label}</a>`));
    assert.match(page, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/);
    assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(!/<script\b/.test(page), 'no script');
  }
});

// ── the helpers ─────────────────────────────────────────────────────────────
test('numbers: thousands separators, CMN to two decimals rounded down, the full value for a title, basis points as percent', () => {
  assert.equal(M.int(1166340), '1,166,340');
  assert.equal(M.int(null), '');
  assert.equal(M.cmn('1084514632607691'), '1,084.51 CMN');
  assert.equal(M.cmn('50000000000000'), '50 CMN');
  assert.equal(M.cmnExact('1084514632607691'), '1,084.514632607691 CMN');
  assert.equal(M.cmnShort('6054836317050833702831', 12, ''), '6.05 billion');
  assert.equal(M.cmnShort('100000000000000000000000', 12, 'CMN'), '100 billion CMN');
  assert.equal(M.cmnShort('0', 12, ''), '0');
  assert.equal(M.bps(3000), '30 %');
  assert.equal(M.bps(25), '0.25 %');
  assert.equal(M.decodeUint('0xad000000', 4), 173);
  assert.equal(M.decodeUint('0xaf8f63c575cebb3b4801000000000000', 16), '6054836317050833702831');
  assert.throws(() => M.decodeUint('0xad00', 4));
});

test('times: relative under a day, UTC otherwise; durations', () => {
  const now = Date.parse('2026-10-23T20:00:00Z');
  assert.equal(M.ago(now - 4_000, now), '4 s ago');
  assert.equal(M.ago(now - 240_000, now), '4 min ago');
  assert.equal(M.ago(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(M.ago(now - 2 * 86_400_000, now), '21 Oct 2026');
  assert.equal(M.utc(now), '23 Oct 2026, 20:00 UTC');
  assert.equal(M.day('2026-09-09'), '9 Sep 2026');
  assert.equal(M.duration(40), 'about 40 s');
  assert.equal(M.duration(11_040), 'about 3 h 4 min');
  assert.equal(M.durationNb(11_040), 'about 3\u00a0h 4\u00a0min');
});

test('the block time is the timestamp inherent, decoded from the block as the node returns it', () => {
  // A real timestamp.set from the public chain: length 10, bare v5, pallet 1, call 0, compact u64.
  assert.equal(M.blockTimestamp(['0x280501000b90ad5a6aa101'], 1), 1792785690000);
  assert.equal(M.blockTimestamp(['0x280501000b90ad5a6aa101'], 2), null, 'not the timestamp pallet');
  assert.equal(M.blockTimestamp(['0xzz'], 1), null);
});

test('validators: the set, the queue, and who sealed a block, through the BABE key each stash queued', () => {
  const key = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : i));
  const stashes = [key(1), key(2), key(3)];
  const babe = [key(11), key(12), key(13), key(14)];
  const set = M.buildSet({
    validators: stashes.slice(0, 2),
    queued: [0, 1, 2].map((i) => ({ stash: stashes[i], babe: babe[i], grandpa: key(20 + i), authorityDiscovery: key(30 + i) })),
    babe: [babe[1], babe[0], babe[3]].map((k) => ({ key: k, weight: 1 })),
  });
  assert.equal(set.active.length, 2);
  assert.deepEqual(set.queued.map((v) => v.queued), [true]);
  assert.match(set.active[0].address, /^5[1-9A-HJ-NP-Za-km-z]{47}$/);
  // A secondary-plain BABE pre-digest naming authority index 1 → babe[0] → stash 1.
  const header = (n, index) => ({ number: `0x${n.toString(16)}`, digest: { logs: [`0x064241424534${'02'}${index.toString(16).padStart(2, '0')}0000002f4acf1100000000`] } });
  assert.equal(M.authorOf(header(10, 1), set.authorities), set.active[0].stashHex);
  assert.equal(M.authorOf(header(10, 2), set.authorities), null, 'a key nobody queued is not attributed');
  assert.equal(M.authorOf(header(10, 9), set.authorities), null, 'beyond the list');
  assert.equal(M.authorOf(header(10, 1), null), null, 'no authority list, no author');
  const by = M.authorship([header(10, 1), header(11, 0), header(12, 1)], set.authorities);
  assert.deepEqual(by.get(set.active[0].stashHex), { count: 2, last: 12 });
  assert.deepEqual(by.get(set.active[1].stashHex), { count: 1, last: 11 });
});

test('agents, disputes and events in plain words', () => {
  const agents = [
    { address: 'a', registeredAtBlock: 5, lastHeartbeatBlock: 990, metadata: { name: 'swarm-1' } },
    { address: 'b', registeredAtBlock: 9, lastHeartbeatBlock: 10, metadata: null },
    { address: 'c', registeredAtBlock: 7, lastHeartbeatBlock: 995, metadata: { name: 'keith' } },
  ];
  const f = M.agentFigures(agents, 1000, 100);
  assert.deepEqual([f.registered, f.operatorRun, f.active, f.newest.map((a) => a.address).join('')], [3, 1, 2, 'bca']);
  assert.deepEqual(M.disputeFigures([{ status: 'Disputed', buyer: 'a', provider: 'b' }, { status: 'Disputed', buyer: 'a', provider: 'c' }, { status: 'Created', buyer: 'd', provider: 'e' }]), { disputes: 2, agents: 3 });
  assert.equal(M.countSince([{ blockNumber: 10 }, { blockNumber: 5 }, { blockNumber: 1 }], 5), 2);
  assert.equal(M.eventWords({ section: 'escrow', method: 'AgreementCreated' }), 'Agreement opened');
  assert.equal(M.eventWords({ section: 'messages', method: 'MessageRead' }), 'Message read');
  assert.equal(M.eventBadge({ kind: 'dispute', method: 'DisputeOpened' }), 'Dispute');
  assert.equal(M.eventBadge({ kind: 'slash', method: 'SlashExecuted' }), 'Slashed');
  assert.equal(M.eventDetails({ section: 'escrow', data: { buyer: 'x', provider: 'y', seq: 14, amount: '20000000000000' } }), 'Agreement 14, 20 CMN');
  assert.equal(M.eventDetails({ section: 'messages', data: { from: 'x', to: 'y', kind: 'DeliveryNotice', payload_len: 292 } }), 'Delivery notice, 292 bytes');
  assert.equal(M.eventDetails({ section: 'agents', data: { who: 'x' } }), '');
  assert.ok(!/5[1-9A-HJ-NP-Za-km-z]{40}/.test(M.eventDetails({ section: 'agents', data: { who: '5FxmBmmd4ujrU5tvxq8ATq3nCbA2Gw8yfMiko7dKRT8GduiA' } })), 'an agent is never repeated in Details');
  assert.equal(M.emptyActivity('', 1165870), 'No agent events in the last hour. Last one at block 1,165,870.');
  assert.equal(M.emptyActivity('slash', 730193), 'No slashes in the last hour. Last one at block 730,193.');
  assert.equal(M.emptyActivity('dispute', null), 'No disputes in the indexed history.');
  assert.deepEqual(M.CHIPS.map((c) => c.label), ['All', 'Agreements', 'Disputes', 'Messages', 'Registrations', 'Slashes']);
});

test('an empty-state sentence wraps on a phone: no nowrap rule reaches a table’s empty cell', () => {
  const css = readFileSync(new URL('../src/network.css', import.meta.url), 'utf8');
  for (const rule of css.match(/[^{}]+\{[^}]*white-space:\s*nowrap[^}]*\}/g) ?? []) {
    for (const sel of rule.slice(0, rule.indexOf('{')).split(',').map((s) => s.trim())) {
      if (/td:first-child/.test(sel)) assert.match(sel, /:not\(\.sc-empty-cell\)/, `${sel} would keep "No agent events…" on one line at 390 px`);
    }
  }
});
