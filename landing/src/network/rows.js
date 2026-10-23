// The tables' columns and rows, as the chrome's table component draws them.
// Every row function returns the cells of one row (HTML strings), so the
// build-time frame hands them to the chrome's table() and the script wraps
// them in tr(): a row looks the same whether it was built or fetched. Pure:
// data in, HTML out; the clock is a parameter.
import { address, badge, escapeHtml, formatDate, formatInt, formatUtc, skeleton } from '../chrome/templates.mjs';
import { BLOCK_WINDOW, EXPLORER_ORIGIN } from './data.js';
import { BADGE_BY_KIND, detailsOf, eventName } from './events.js';
import { nowrap, relativeTime } from './format.js';
import { agentName, agentStatus, isOperatorRun } from './model.js';

export const COLUMNS = {
  validators: [{ label: 'Validator' }, { label: 'Account' }, { label: 'Status' }, { label: `Blocks authored (last ${formatInt(BLOCK_WINDOW)} blocks)`, align: 'right' }, { label: 'Last block', align: 'right' }],
  blocks: [{ label: 'Block', align: 'right' }, { label: 'Age' }, { label: 'Author' }, { label: 'Extrinsics', align: 'right' }, { label: 'Finalized' }],
  activity: [{ label: 'Time' }, { label: 'Event' }, { label: 'Agents' }, { label: 'Details' }],
  agents: [{ label: 'Agent' }, { label: 'Registered at block', align: 'right' }, { label: 'Operator-run' }, { label: 'Status' }],
  history: [{ label: 'Spec', align: 'right' }, { label: 'Block', align: 'right' }, { label: 'Date' }, { label: 'Note' }],
  sources: [{ label: 'Figure' }, { label: 'Source' }, { label: 'Last read' }],
};

/** One table row in the chrome's markup (as `table()` draws it): right-aligned cells take `sc-r`. */
export const tr = (columns, cells, attrs = '') =>
  `<tr${attrs}>${cells.map((cell, i) => `<td${columns[i]?.align === 'right' ? ' class="sc-r"' : ''}>${cell}</td>`).join('')}</tr>`;

/** `n` rows of skeleton cells, each the width of the value it stands for, for `table()`. */
export const skeletonRows = (columns, n, widths = []) => Array.from({ length: n }, () => columns.map((_, i) => skeleton(widths[i] ?? '6ch')));

/** A cell of prose: it keeps a readable measure (src/network.css) and the table scrolls instead. */
export const note = (text) => (text ? `<span class="nk-note">${escapeHtml(text)}</span>` : '');

/** A relative time with the absolute UTC instant in its title; the ticker re-reads `datetime`. */
export function timeCell(ms, nowMs) {
  if (!Number.isFinite(ms)) return '';
  const iso = new Date(ms).toISOString();
  return `<time datetime="${iso}" title="${escapeHtml(formatUtc(iso))}" data-rel>${escapeHtml(relativeTime(ms, nowMs))}</time>`;
}

const explorerAccount = (addr) => `${EXPLORER_ORIGIN}/account/${addr}`;
const explorerBlock = (n) => `${EXPLORER_ORIGIN}/block/${n}`;

/**
 * A validator: its position, account, Active or Queued, blocks authored in
 * the window and the last of them. `windowSize` is how many blocks' authors
 * the page has read; while it is 0 the count is unknown, not zero.
 */
export function validatorRow(v, authored, { windowSize = 0 } = {}) {
  const a = authored.get(v.stashHex) ?? null;
  let count = skeleton('2ch');
  if (v.queued) count = '';
  else if (windowSize > 0) count = formatInt(a?.count ?? 0);
  return [
    escapeHtml(nowrap(`Validator ${formatInt(v.index + 1)}`)),
    address(v.address, { href: explorerAccount(v.address) }),
    badge(v.queued ? 'Queued' : 'Active'),
    count,
    a?.last ? `<a href="${escapeHtml(explorerBlock(a.last))}">${formatInt(a.last)}</a>` : '',
  ];
}

/**
 * A block: height (linked), age, author (the validator's account, or the
 * plain reason it is unknown), extrinsics, finalized. `authorOf(block)` is
 * `{ address }`, `{ authorityIndex }` when the index maps to no validator the
 * page knows, `{ failed }` with the reason when the header could not be read,
 * false when the header names nobody, or null while unread.
 */
export function blockRow(block, { finalized, nowMs, authorOf }) {
  const author = authorOf(block);
  let authorCell = skeleton('10ch');
  if (author?.address) authorCell = address(author.address, { href: explorerAccount(author.address) });
  else if (author && Number.isInteger(author.authorityIndex)) authorCell = `<span class="sc-muted" title="The BABE authority at index ${escapeHtml(String(author.authorityIndex))} is not in the session keys the page read.">Not mapped</span>`;
  else if (author === false) authorCell = '<span class="sc-muted" title="The header carries no BABE pre-digest, so it names no author.">Unknown</span>';
  else if (author?.failed) authorCell = `<span class="sc-muted" title="${escapeHtml(author.failed)}">Not read</span>`;
  const final = Number.isFinite(finalized) && block.number <= finalized;
  return [
    `<a href="${escapeHtml(explorerBlock(block.number))}">${formatInt(block.number)}</a>`,
    Number.isFinite(block.timestampMs) ? timeCell(block.timestampMs, nowMs) : '',
    authorCell,
    Number.isInteger(block.extrinsics) ? formatInt(block.extrinsics) : skeleton('2ch'),
    final ? badge('Finalized') : badge('Pending'),
  ];
}

/** An agent event: when, what (in words, a badge for a dispute or a slash), who, and the details that matter. */
export function activityRow(item, nowMs) {
  const who = (item.agents ?? []).map((a) => address(a, { href: explorerAccount(a) })).join(' ');
  const word = BADGE_BY_KIND[item.kind];
  const name = escapeHtml(eventName(item.section, item.method));
  return [
    Number.isFinite(item.timestampMs) ? timeCell(item.timestampMs, nowMs) : `<a href="${escapeHtml(explorerBlock(item.blockNumber))}">${formatInt(item.blockNumber)}</a>`,
    word ? `${name} ${badge(word)}` : name,
    who,
    note(detailsOf(item)),
  ];
}

/** A registered agent: name and account, the block it registered at, operator-run, and its status. */
export function agentRow(item, context) {
  const name = agentName(item);
  const status = agentStatus(item, context);
  const who = address(item.address, { href: explorerAccount(item.address) });
  return [
    name ? `${escapeHtml(name)} ${who}` : who,
    `<a href="${escapeHtml(explorerBlock(item.registeredAtBlock))}">${formatInt(item.registeredAtBlock)}</a>`,
    isOperatorRun(name) ? badge('Operator-run') : '',
    status.badge ? badge(status.badge) : escapeHtml(nowrap(status.text)),
  ];
}

/** A runtime upgrade from runtime-history.json. */
export function historyRow(entry) {
  return [
    formatInt(entry.specVersion),
    `<a href="${escapeHtml(explorerBlock(entry.appliedAtBlock))}">${formatInt(entry.appliedAtBlock)}</a>`,
    escapeHtml(nowrap(formatDate(`${entry.date}T00:00:00Z`))),
    note(entry.summary),
  ];
}

/** "1,166,750 · 23 Oct 2026, 19:35 UTC" for the sources table's last-read cell. */
export function readCell(block, at) {
  const when = nowrap(formatUtc(new Date(at).toISOString()));
  return Number.isFinite(block) ? `${formatInt(block)} · ${when}` : when;
}
