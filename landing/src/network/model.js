// The /network page's pure helpers: decoding the few raw values the page reads
// off the node, turning indexer rows into plain words, and the arithmetic
// behind each figure. No DOM, no clock (every "now" is a parameter), so the
// test suite holds each one to its inputs. Shared by the build-time render
// (src/network.mjs) and the browser script (src/network/main.js).

import { bytesToHex, decodeBabeAuthorities, decodeQueuedKeys, decodeValidators, hexToBytes, readCompact, babePreDigestOf } from '../observatory/scale.js';
import { encodeSs58 } from '../observatory/ss58.js';

export { decodeBabeAuthorities, decodeQueuedKeys, decodeValidators, babePreDigestOf };

// ── numbers ─────────────────────────────────────────────────────────────────
const groups = new Intl.NumberFormat('en-US');
/** 1234567 → "1,234,567"; BigInt-safe; '' for an unknown. */
export const int = (value) => (value === null || value === undefined || value === '' ? '' : groups.format(BigInt(value)));

/** Plancks → "1,234.56 CMN" (never more than 2 decimals, rounded down; the full value belongs in a title). */
export function cmn(plancks, decimals = 12, symbol = 'CMN') {
  if (plancks === null || plancks === undefined) return '';
  const v = BigInt(plancks);
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const cents = ((v % scale) * 100n) / scale;
  return `${groups.format(whole)}${cents ? `.${String(cents).padStart(2, '0')}` : ''}${symbol ? ` ${symbol}` : ''}`;
}
/** Plancks → "6.05 billion CMN" for a stat that must fit its cell; below a million, as `cmn`. Rounded down. */
export function cmnShort(plancks, decimals = 12, symbol = 'CMN') {
  if (plancks === null || plancks === undefined) return '';
  const whole = BigInt(plancks) / 10n ** BigInt(decimals);
  for (const [size, name] of [[10n ** 9n, 'billion'], [10n ** 6n, 'million']]) {
    if (whole >= size) {
      const hundredths = (whole * 100n) / size;
      const text = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
      return symbol ? `${text} ${name} ${symbol}` : `${text} ${name}`;
    }
  }
  return cmn(plancks, decimals, symbol).trim();
}
/** Plancks → the exact value with every decimal, for a title. */
export function cmnExact(plancks, decimals = 12, symbol = 'CMN') {
  const v = BigInt(plancks);
  const scale = 10n ** BigInt(decimals);
  const frac = String(v % scale).padStart(decimals, '0').replace(/0+$/, '');
  return `${groups.format(v / scale)}${frac ? `.${frac}` : ''} ${symbol}`;
}
/** Basis points → "5 %", "0.25 %". */
export const bps = (value) => `${Number(value) / 100} %`;

/** A u32 or u64 little-endian storage value → Number; a u128 → BigInt string. */
export function decodeUint(hex, bytes) {
  const b = hexToBytes(hex);
  if (b.length !== bytes) throw new Error(`storage value is ${b.length} bytes, expected ${bytes}`);
  let v = 0n;
  for (let i = bytes - 1; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[i]);
  return bytes > 6 ? v.toString() : Number(v);
}

/** "0x11cc04" → 1166340. */
export const headerNumber = (header) => Number.parseInt(header.number, 16);

/** Seconds → "about 3 h 14 min" / "about 40 s". */
export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `about ${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}
/** The same, with no line break inside a number and its unit. */
export const durationNb = (seconds) => duration(seconds).replace(/ (h|min|s)\b/g, '\u00a0$1');

/** "4 s ago", "4 min ago", "3 h ago": anything under a day; older is a date. */
export function ago(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return utc(ms).replace(/, .*$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Epoch ms or ISO → "23 Oct 2026, 11:32 UTC". */
export function utc(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
/** Epoch ms → "20:11:05 UTC". */
export const clock = (at) => `${new Date(at).toISOString().slice(11, 19)} UTC`;
/** "2026-09-09" → "9 Sep 2026". */
export const day = (iso) => utc(`${iso}T00:00:00Z`).replace(/, .*$/, '');

/** "5FxmB…8GduiA". */
export const short = (value, head = 6, tail = 4) => {
  const s = String(value ?? '');
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

// ── blocks ──────────────────────────────────────────────────────────────────
/**
 * The chain's own time for a block: the `timestamp.set` inherent, the
 * extrinsic whose call is (timestamp pallet, call 0), its one argument a
 * compact u64 of milliseconds. Null when no extrinsic is that call.
 */
export function blockTimestamp(extrinsics, timestampPallet) {
  for (const hex of extrinsics ?? []) {
    try {
      const bytes = hexToBytes(hex);
      const { next } = readCompact(bytes, 0); // the length prefix
      const version = bytes[next];
      if (version & 0x80) continue; // signed: never the inherent
      if (bytes[next + 1] !== timestampPallet || bytes[next + 2] !== 0) continue;
      return readCompact(bytes, next + 3).value;
    } catch {
      // not decodable as the inherent; try the next
    }
  }
  return null;
}

// ── validators ──────────────────────────────────────────────────────────────
/**
 * The validator set from the three raw values, as the old ring read them:
 * `Session.Validators` (the active stashes), `Session.QueuedKeys` (the
 * stashes queued for the next session with their BABE keys) and
 * `Babe.Authorities` (the BABE keys in authority-index order). A block's
 * author is the authority index in its BABE pre-digest, mapped through the
 * BABE key each stash queued. Either of the last two may be null when its
 * read failed: the set still lists, authorship is then unknown.
 */
export function buildSet({ validators, queued = null, babe = null, ss58 = 42 }) {
  const babeByStash = new Map((queued ?? []).map((e) => [bytesToHex(e.stash), bytesToHex(e.babe)]));
  const active = validators.map((key) => {
    const stashHex = bytesToHex(key);
    return { stashHex, address: encodeSs58(key, ss58), babeHex: babeByStash.get(stashHex) ?? null, queued: false };
  });
  const activeHex = new Set(active.map((v) => v.stashHex));
  const joining = [];
  for (const e of queued ?? []) {
    const stashHex = bytesToHex(e.stash);
    if (activeHex.has(stashHex) || joining.some((v) => v.stashHex === stashHex)) continue;
    joining.push({ stashHex, address: encodeSs58(e.stash, ss58), babeHex: bytesToHex(e.babe), queued: true });
  }
  const stashByBabe = new Map([...active, ...joining].filter((v) => v.babeHex).map((v) => [v.babeHex, v.stashHex]));
  const authorities = babe ? babe.map((e) => stashByBabe.get(bytesToHex(e.key)) ?? null) : null;
  return { active, queued: joining, authorities };
}

/** The stash (hex) that sealed a header, or null when it cannot be attributed. */
export function authorOf(header, authorities) {
  if (!authorities) return null;
  let pre;
  try {
    pre = babePreDigestOf(header);
  } catch {
    return null;
  }
  if (!pre || pre.authorityIndex >= authorities.length) return null;
  return authorities[pre.authorityIndex] ?? null;
}

/** Per stash: blocks authored in `headers` and the highest block it sealed. */
export function authorship(headers, authorities) {
  const out = new Map();
  for (const header of headers) {
    const stash = authorOf(header, authorities);
    if (!stash) continue;
    const n = headerNumber(header);
    const e = out.get(stash) ?? { count: 0, last: null };
    e.count += 1;
    e.last = e.last === null ? n : Math.max(e.last, n);
    out.set(stash, e);
  }
  return out;
}

// ── agents ──────────────────────────────────────────────────────────────────
/** Operator-run: the agents the operator runs carry the `swarm-` prefix on their on-chain name. */
export const isOperatorRun = (agent) => Boolean(agent?.metadata?.name?.startsWith('swarm-'));
/** Active: a heartbeat within the grace period. */
export const isActive = (agent, head, grace) => head - agent.lastHeartbeatBlock <= grace;

/** The figures of the Agents section from the whole agent list. */
export function agentFigures(agents, head, grace) {
  return {
    registered: agents.length,
    operatorRun: agents.filter(isOperatorRun).length,
    active: agents.filter((a) => isActive(a, head, grace)).length,
    newest: [...agents].sort((a, b) => b.registeredAtBlock - a.registeredAtBlock || (a.address < b.address ? -1 : 1)).slice(0, 10),
  };
}

/** Agreements in dispute, and the distinct agents party to them, from an escrow list. */
export function disputeFigures(agreements) {
  const disputed = agreements.filter((a) => a.status === 'Disputed');
  const agents = new Set(disputed.flatMap((a) => [a.buyer, a.provider]));
  return { disputes: disputed.length, agents: agents.size };
}

/** Events at or after `fromBlock` in a newest-first list. */
export const countSince = (items, fromBlock) => items.filter((e) => e.blockNumber >= fromBlock).length;

// ── activity in words ───────────────────────────────────────────────────────
export const EVENT_WORDS = {
  'agents.AgentRegistered': 'Agent registered',
  'agents.HeartbeatSent': 'Heartbeat',
  'agents.SlashExecuted': 'Agent slashed',
  'agents.SlashAppealed': 'Slash appealed',
  'agents.SlashAppealWithdrawn': 'Slash appeal withdrawn',
  'escrow.AgreementCreated': 'Agreement opened',
  'escrow.AgreementAccepted': 'Agreement accepted',
  'escrow.AgreementRejected': 'Agreement rejected',
  'escrow.PendingCancelled': 'Agreement cancelled',
  'escrow.AgreementExpired': 'Agreement expired',
  'escrow.DeliveryRecorded': 'Delivery recorded',
  'escrow.DeliveryConfirmed': 'Delivery confirmed',
  'escrow.RefundClaimed': 'Refund claimed',
  'escrow.DeadlineExtended': 'Deadline extended',
  'escrow.DisputeOpened': 'Dispute opened',
  'escrow.DisputeResolved': 'Dispute resolved',
  'oracle.OracleResponseSubmitted': 'Oracle answer',
  'oracle.BatchResponseSubmitted': 'Oracle answers sent as a batch',
  'messages.MessageSent': 'Message sent',
};
/** "DeliveryNotice" → "Delivery notice". */
export const words = (camel) => {
  const s = String(camel).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const eventWords = (e) => EVENT_WORDS[`${e.section}.${e.method}`] ?? words(e.method);
/** The status word an event carries as a badge, if any. */
export const eventBadge = (e) => (e.kind === 'dispute' && e.method === 'DisputeOpened' ? 'Dispute' : e.method === 'SlashExecuted' ? 'Slashed' : null);

/** The fields of an event that matter, in words; the agents' own addresses are never repeated. */
export function eventDetails(e, decimals = 12, symbol = 'CMN') {
  const d = e.data ?? {};
  const parts = [];
  if (d.seq !== undefined) parts.push(`Agreement ${d.seq}`);
  if (d.amount !== undefined) parts.push(cmn(d.amount, decimals, symbol));
  if (d.stake !== undefined) parts.push(`Stake ${cmn(d.stake, decimals, symbol)}`);
  if (d.fee !== undefined) parts.push(`Fee ${cmn(d.fee, decimals, symbol)}`);
  if (d.kind !== undefined && typeof d.kind === 'string') parts.push(words(d.kind));
  if (d.payload_len !== undefined) parts.push(`${int(d.payload_len)} bytes`);
  if (d.slash_era !== undefined) parts.push(`Era ${int(d.slash_era)}`);
  if (e.section === 'oracle' && typeof d.id === 'string') parts.push(`Request ${short(d.id)}`);
  return parts.join(', ');
}

/** The filter chips, in order: label → the indexer's `?kind=`. */
export const CHIPS = [
  { label: 'All', value: '' },
  { label: 'Agreements', value: 'agreement' },
  { label: 'Disputes', value: 'dispute' },
  { label: 'Messages', value: 'message' },
  { label: 'Registrations', value: 'registration' },
  { label: 'Slashes', value: 'slash' },
];

/** The empty-state sentence for a filter. */
export function emptyActivity(kind, last) {
  const what = kind ? `${CHIPS.find((c) => c.value === kind)?.label.toLowerCase() ?? 'agent events'}` : 'agent events';
  if (last === null || last === undefined) return `No ${what} in the indexed history.`;
  return `No ${what} in the last hour. Last one at block ${int(last)}.`;
}
