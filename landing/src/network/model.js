// What the network page derives from what it reads, as pure functions over
// plain data: the validator set and who authored each block, the agents'
// counts and status words, open disputes from the dispute events, the index's
// newest hour, the era's next settlement, and the words the page uses when a
// read fails. No DOM, no clock, no network; all tested.
import { bytesToHex, babePreDigestOf } from './scale.js';
import { encodeSs58 } from './ss58.js';
import { formatDuration } from './format.js';

export const SS58_FORMAT = 42;
/** The runtime's HOURS: SECS_PER_BLOCK = 6 (runtime/src/lib.rs), so 600 blocks. */
export const BLOCKS_PER_HOUR = 600;
/** An agent whose on-chain name starts with this is run by the network's operator. */
export const OPERATOR_PREFIX = 'swarm-';
/** Figures older than this, or a node that does not answer, put the warning above the status row. */
export const STALE_AFTER_MS = 60_000;

// ── validators ───────────────────────────────────────────────────────────────

/**
 * The validator set from the three decoded storage values: `validators` is
 * Session.Validators (stash keys), `queued` Session.QueuedKeys, `babe`
 * Babe.Authorities. Either of the last two may be null when its read failed:
 * the set is still listed, and authorship is then unmapped, never guessed.
 * `authorities[i]` is the stash (hex) behind BABE authority index i, or null.
 */
export function validatorSet({ validators, queued = null, babe = null }) {
  const keysByStash = new Map();
  for (const entry of queued ?? []) keysByStash.set(bytesToHex(entry.stash), bytesToHex(entry.babe));
  const active = validators.map((key, index) => {
    const stashHex = bytesToHex(key);
    return { index, stashHex, address: encodeSs58(key, SS58_FORMAT), babeHex: keysByStash.get(stashHex) ?? null, queued: false };
  });
  const activeHex = new Set(active.map((v) => v.stashHex));
  const joining = [];
  for (const entry of queued ?? []) {
    const stashHex = bytesToHex(entry.stash);
    if (activeHex.has(stashHex) || joining.some((v) => v.stashHex === stashHex)) continue;
    joining.push({ index: active.length + joining.length, stashHex, address: encodeSs58(entry.stash, SS58_FORMAT), babeHex: bytesToHex(entry.babe), queued: true });
  }
  const stashByBabe = new Map([...active, ...joining].map((v) => [v.babeHex, v.stashHex]));
  const authorities = (babe ?? []).map((entry) => stashByBabe.get(bytesToHex(entry.key)) ?? null);
  return { active, queued: joining, authorities };
}

/**
 * Who authored a block, from its header's BABE pre-digest: the authority
 * index, and the stash (hex) it maps to through the set, or null when the
 * index is beyond the authority list or its key is not in the queued keys.
 * Null when the header carries no BABE pre-digest.
 */
export function authorOf(header, authorities = []) {
  const digest = babePreDigestOf(header);
  if (!digest) return null;
  const { authorityIndex } = digest;
  const stashHex = authorityIndex >= 0 && authorityIndex < authorities.length ? (authorities[authorityIndex] ?? null) : null;
  return { authorityIndex, stashHex };
}

/** A map of stash (hex) → { count, last } over the blocks given, each `{ number, authorHex }`. */
export function authoredCounts(blocks) {
  const out = new Map();
  for (const block of blocks) {
    if (!block.authorHex) continue;
    const entry = out.get(block.authorHex) ?? { count: 0, last: null };
    entry.count += 1;
    entry.last = Math.max(entry.last ?? 0, block.number);
    out.set(block.authorHex, entry);
  }
  return out;
}

/**
 * The page's log of recent blocks: a map by height, trimmed to `keep`
 * entries. `add` merges a block's fields into what is already known (the
 * indexer gives a block's time and extrinsics, a header gives its author).
 */
export function blockLog(keep) {
  const blocks = new Map();
  const trim = () => {
    if (blocks.size <= keep) return;
    const numbers = [...blocks.keys()].sort((a, b) => a - b);
    for (const n of numbers.slice(0, blocks.size - keep)) blocks.delete(n);
  };
  return {
    add(block) {
      if (!Number.isInteger(block.number)) throw new Error('a block needs a number');
      const known = blocks.get(block.number) ?? { number: block.number };
      for (const [k, v] of Object.entries(block)) if (v !== undefined && v !== null) known[k] = v;
      blocks.set(block.number, known);
      trim();
      return known;
    },
    get: (number) => blocks.get(number) ?? null,
    /** Newest first, at most `limit`. */
    rows(limit = keep) {
      return [...blocks.values()].sort((a, b) => b.number - a.number).slice(0, limit);
    },
    size: () => blocks.size,
    /** The highest block number known; null when empty. */
    head() {
      let max = null;
      for (const n of blocks.keys()) if (max === null || n > max) max = n;
      return max;
    },
  };
}

// ── agents ───────────────────────────────────────────────────────────────────

/** An agent's on-chain name, or null when it has none. */
export const agentName = (item) => (item?.metadata && typeof item.metadata === 'object' && typeof item.metadata.name === 'string' ? item.metadata.name : null);

/** An agent is operator-run when its on-chain name starts with `swarm-`; an agent with no name is not. */
export const isOperatorRun = (name) => typeof name === 'string' && name.startsWith(OPERATOR_PREFIX);

/** Active means a heartbeat within the grace period (`heartbeatGracePeriod` blocks) of the head. */
export const isActive = (item, { head, grace }) => Number.isFinite(head) && head - Number(item.lastHeartbeatBlock) <= grace;

/**
 * The status column: the Active badge, or the plain reason it is not —
 * "Unstaking" or "No heartbeat for {{duration}}". `blockMs` turns the blocks
 * since the last heartbeat into time.
 */
export function agentStatus(item, { head, grace, blockMs }) {
  if (item.unstakeAtBlock !== null && item.unstakeAtBlock !== undefined) return { badge: null, text: 'Unstaking' };
  if (!Number.isFinite(head)) return { badge: null, text: '' };
  if (isActive(item, { head, grace })) return { badge: 'Active', text: '' };
  const silent = (head - Number(item.lastHeartbeatBlock)) * (blockMs / 1000);
  return { badge: null, text: `No heartbeat for ${formatDuration(silent).replace(/^about /, '')}` };
}

/** The counts the Agents section shows, and the most recently registered agents. */
export function agentSummary(items, { head, grace, disputed = new Set(), recent = 10 }) {
  let operatorRun = 0;
  let active = 0;
  let inDispute = 0;
  for (const item of items) {
    if (isOperatorRun(agentName(item))) operatorRun += 1;
    if (isActive(item, { head, grace })) active += 1;
    if (disputed.has(item.address)) inDispute += 1;
  }
  const byRegistration = [...items].sort((a, b) => Number(b.registeredAtBlock) - Number(a.registeredAtBlock) || String(a.address).localeCompare(String(b.address)));
  return { registered: items.length, operatorRun, active, inDispute, recent: byRegistration.slice(0, recent) };
}

// ── disputes ─────────────────────────────────────────────────────────────────

/**
 * Open disputes: every escrow.DisputeOpened without a later DisputeResolved
 * for the same agreement (buyer, provider, seq). `count` is the number open
 * and `agents` the set of addresses party to at least one. Both lists are
 * the indexer's, newest first.
 */
export function openDisputes(opened, resolved) {
  const key = (e) => `${e.data?.buyer}/${e.data?.provider}/${e.data?.seq}`;
  const closed = new Map();
  for (const e of resolved) closed.set(key(e), Math.max(closed.get(key(e)) ?? 0, e.blockNumber));
  let count = 0;
  const agents = new Set();
  for (const e of opened) {
    const k = key(e);
    if (closed.has(k) && closed.get(k) >= e.blockNumber) continue;
    count += 1;
    if (e.data?.buyer) agents.add(e.data.buyer);
    if (e.data?.provider) agents.add(e.data.provider);
  }
  return { count, agents };
}

// ── the hour, the era ────────────────────────────────────────────────────────

/**
 * The index's newest hour from a /v1/status body: the 600 blocks up to the
 * newest block the index has synced, and how far that is behind the head. An
 * hour measured from the chain's head would start past everything the index
 * holds whenever the index lags, and every count would read zero.
 */
export function hourWindow(status, field) {
  const to = field(status, 'indexer.syncedHeight');
  const best = field(status, 'chain.bestBlock');
  return { since: Math.max(0, to - BLOCKS_PER_HOUR), to, best, behind: Math.max(0, best - to) };
}

/** Events (newest first) at or after `since`. */
export const sinceBlock = (items, since) => items.filter((item) => Number(item.blockNumber) >= since);

/** The activity table's empty sentence: `items` is everything the feed returned (newest first), none of it within the hour. */
export function activityEmpty(items, formatInt, noun = 'agent events') {
  if (items.length === 0) return `No ${noun} in the index.`;
  return `No ${noun} in the last hour. Last one at block ${formatInt(items[0].blockNumber)}.`;
}

/**
 * When the era in progress settles: the block, and the time until it at
 * `blockMs` a block. `due` when the window is already open (anyone may call
 * settle_era then).
 */
export function nextSettlement(era, field, { blockMs }) {
  const start = field(era, 'startBlock');
  const duration = field(era, 'durationBlocks');
  const remaining = field(era, 'blocksRemaining');
  const due = field(era, 'dueForSettlement') === true;
  return { block: start + duration, seconds: Math.max(0, remaining) * (blockMs / 1000), due };
}

// ── words for a read that failed ─────────────────────────────────────────────

/**
 * The one warning above the status row: a plain sentence per service and
 * reason for the reads that fail (`sentencesOf` groups them), and how old
 * the figures are when the last good read is more than STALE_AFTER_MS ago.
 * Empty when everything reads. `failures` is a map of source name → record.
 */
export function warningText({ failures, lastOkAt, nowMs, formatUtc, sentencesOf }) {
  if (!(failures instanceof Map)) throw new Error('failures is a map of source name to record');
  const lines = sentencesOf([...failures.values()]);
  if (Number.isFinite(lastOkAt) && nowMs - lastOkAt > STALE_AFTER_MS) {
    lines.push(`Values are from ${formatUtc(new Date(lastOkAt).toISOString())}; nothing has been read for ${formatDuration((nowMs - lastOkAt) / 1000).replace(/^about /, '')}.`);
  } else if (lines.length > 0 && Number.isFinite(lastOkAt)) {
    lines.push(`Values are from ${formatUtc(new Date(lastOkAt).toISOString())}.`);
  }
  return lines.join(' ');
}
