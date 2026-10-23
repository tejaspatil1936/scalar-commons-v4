// Agent events in plain words. The activity table says "Agreement opened",
// never `escrow.AgreementOpened`; this is the one place the mapping lives,
// and the tests hold every pair here to the runtime's own event list
// (chain-events.json) and every event the indexer's feed reports to a name.
import { formatInt } from '../chrome/templates.mjs';
import { formatCmn, words } from './format.js';

/** `section.method` → what a visitor reads. */
export const EVENT_NAMES = {
  'agents.AgentRegistered': 'Agent registered',
  'agents.HeartbeatSent': 'Heartbeat sent',
  'agents.SlashExecuted': 'Slash executed',
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
  'oracle.BatchResponseSubmitted': 'Oracle answers in a batch',
  'messages.MessageSent': 'Message sent',
};

/** The plain name of an event; an event not in the list is still read as words ("Agreement created"). */
export function eventName(section, method) {
  return EVENT_NAMES[`${section}.${method}`] ?? words(method);
}

/** The filter chips, in order: the label a visitor sees, the indexer's `?kind=`, and the noun the empty sentence uses. */
export const KINDS = [
  { label: 'All', value: '', noun: 'agent events' },
  { label: 'Agreements', value: 'agreement', noun: 'agreement events' },
  { label: 'Disputes', value: 'dispute', noun: 'dispute events' },
  { label: 'Messages', value: 'message', noun: 'messages' },
  { label: 'Registrations', value: 'registration', noun: 'registrations' },
  { label: 'Slashes', value: 'slash', noun: 'slashes' },
];

/** The events that carry a status badge in the table. */
export const BADGE_BY_KIND = { dispute: 'Dispute', slash: 'Slashed' };

const isAddress = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{46,48}$/.test(v);
const safe = (fn, v) => {
  try {
    return fn(v);
  } catch {
    return String(v);
  }
};
const num = (v) => safe(formatInt, v);
const cmn = (plancks) => safe((p) => `${formatCmn(p).text} CMN`, plancks);
const shortHex = (hex) => (typeof hex === 'string' && hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : String(hex));

/**
 * The Details cell: the fields that matter, in words, never an address (the
 * Agents column carries those) and never a raw field name. Pure; tested.
 */
export function detailsOf(item) {
  const d = item?.data && typeof item.data === 'object' ? item.data : {};
  const key = `${item?.section}.${item?.method}`;
  const parts = [];
  switch (key) {
    case 'agents.AgentRegistered':
      if (d.stake !== undefined) parts.push(`Stake ${cmn(d.stake)}`);
      if (d.fee !== undefined) parts.push(`fee ${cmn(d.fee)}`);
      break;
    case 'agents.HeartbeatSent':
      break;
    case 'escrow.AgreementCreated':
      if (d.amount !== undefined) parts.push(cmn(d.amount));
      if (d.seq !== undefined) parts.push(`agreement no. ${num(d.seq)}`);
      break;
    case 'escrow.DisputeResolved':
      if (d.seq !== undefined) parts.push(`Agreement no. ${num(d.seq)}`);
      if (typeof d.provider_wins === 'boolean') parts.push(d.provider_wins ? 'the provider wins' : 'the buyer wins');
      break;
    case 'messages.MessageSent':
      if (d.kind !== undefined) parts.push(words(d.kind));
      if (d.payload_len !== undefined) parts.push(`${num(d.payload_len)} bytes`);
      break;
    default:
      if (d.seq !== undefined) parts.push(`Agreement no. ${num(d.seq)}`);
      if (d.amount !== undefined) parts.push(cmn(d.amount));
      if (d.request_id !== undefined) parts.push(`request ${shortHex(d.request_id)}`);
      if (d.slash_id !== undefined) parts.push(`slash no. ${num(d.slash_id)}`);
      if (parts.length === 0) {
        for (const [k, v] of Object.entries(d)) {
          if (isAddress(v) || v === null || typeof v === 'object') continue;
          parts.push(`${words(k).toLowerCase()}: ${typeof v === 'number' ? num(v) : String(v)}`);
          if (parts.length === 2) break;
        }
      }
  }
  const text = parts.join(', ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
