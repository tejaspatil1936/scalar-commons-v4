// Part B · the sky. `/observatory?sky=1` lays a WebGL star field behind the
// plates, drawn from the same reads the plates make, so the two can never
// disagree:
//
//   · one star per registered agent (`/v1/agents`), at a position fixed by a
//     hash of its address (see `placeOf`), sized by its stake and brightened
//     by its recent activity;
//   · the active validators (`Session.Validators`) as bright fixed stars with
//     a faint reticle;
//   · one thin line per open agreement (`/v1/escrows`) between its two stars;
//     a dispute flickers amber once; a settlement (`escrow.DeliveryConfirmed`)
//     resolves to a steady low glow that fades over ten minutes;
//   · each new block sends a faint light front right to left across the
//     field, and the region behind the finality marker settles to a steady
//     glow, as the river's finalized band does.
//
// The camera drifts one degree a minute and the field has depth: point size
// falls with distance and stars add their light where they overlap. The
// scene itself (three.js and GSAP) lives in `sky-field.js` and is fetched
// only when the flag is on, so the ordinary page never pays for it. This
// module holds the pure model — tested without a GPU — and the three ways
// the sky stands down for the canvas hero: no WebGL, prefers-reduced-motion,
// or fewer than 30 frames a second for three seconds. The footer carries the
// sky's own provenance line — how many stars, lines and validators, from
// which reads, when — and says which fallback took effect, if one did. Off
// by default: without the flag nothing here runs and nothing is drawn.
//
// With `?present=1&sky=1` the sky fills the first screen with the live
// block height in the display serif and nothing else.

import { decodeValidators } from './scale.js';
import { encodeSs58 } from './ss58.js';

/** The most stars drawn; the indexer's live scan stops well before this. */
export const MAX_STARS = 4096;
/** Block slots across the field, right to left, as the river's trail. */
export const TRAIL = 60;
/** A light front crosses the field in this long. */
export const FRONT_MS = 1_600;
/** A dispute's amber flicker lasts this long, once. */
export const FLICKER_MS = 1_500;
/** A settlement's glow fades over ten minutes. */
export const SETTLE_FADE_MS = 600_000;
/** The chain's slot time, used to date an event by its block. */
export const SLOT_MS = 6_000;
/** A heartbeat within this many blocks (about an hour) counts as recent activity. */
export const HEARTBEAT_RECENT_BLOCKS = 600;
/** The camera's drift, in degrees per minute. */
export const DRIFT_DEG_PER_MIN = 1;
/** Below this many frames a second, for this many whole seconds, the sky stands down. */
export const MIN_FPS = 30;
export const SLOW_SECONDS = 3;
/** Frames in the warm-up are not judged: the first frames load shaders and buffers. */
export const WARMUP_MS = 2_000;
export const SS58_FORMAT = 42;
/** Frame durations kept for the frame statistics the canvas reports. */
const STATS_WINDOW = 240;

/** Whether the URL asks for the sky. Pure; tested. */
export function wantsSky(search) {
  return /(?:^\?|[?&])sky=1(?:&|$)/.test(search ?? '');
}

/** FNV-1a over a string, as an unsigned 32-bit integer. Pure; tested. */
export function hashAddress(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Where an address sits in the field, in [0, 1)³: `x` from the low sixteen
 * bits of the FNV-1a hash of the SS58 address, `y` from the high sixteen,
 * and `depth` from the low sixteen bits of the hash of the address with
 * `:depth` appended. The address alone decides, so a star is in the same
 * place on every visit, on every screen, whatever else is on the chain; two
 * addresses share a place only by a hash collision at one part in 2³². Pure; tested.
 */
export function placeOf(address) {
  const h = hashAddress(String(address));
  const d = hashAddress(`${address}:depth`);
  return { x: (h & 0xffff) / 0x10000, y: ((h >>> 16) & 0xffff) / 0x10000, depth: (d & 0xffff) / 0x10000 };
}

/**
 * An agent's recent activity, in counts: the agreements it holds open now,
 * its settlements in the last ten minutes, and one more if it has heart-
 * beaten within the last HEARTBEAT_RECENT_BLOCKS. Pure; tested.
 */
export function activityOf(agent, { best = null, recentSettled = new Map() } = {}) {
  const open = Number(agent.activeEscrowCount) || 0;
  const settled = recentSettled.get(agent.address) ?? 0;
  const beat = Number(agent.lastHeartbeatBlock);
  const recent = Number.isFinite(best) && Number.isFinite(beat) && best - beat <= HEARTBEAT_RECENT_BLOCKS ? 1 : 0;
  return open + settled + recent;
}

/**
 * A star from an agent: its place from the address, a size of 3–12 px by the
 * square root of its share of the largest stake (area grows with stake), and
 * a brightness of 0.35–1 by the square root of its share of the busiest
 * agent's recent activity. Pure; tested.
 */
export function starOf(address, { stakePlancks = 0, activity = 0 } = {}, { maxStake = 0, maxActivity = 0 } = {}) {
  const share = (value, max) => (max > 0 ? Math.min(1, Math.sqrt(Math.max(0, value) / max)) : 0);
  const stake = Number(stakePlancks) || 0;
  return { address, ...placeOf(address), kind: 0, size: 3 + 9 * share(stake, maxStake), bright: 0.35 + 0.65 * share(activity, maxActivity) };
}

/** A validator's star: the same place rule, a fixed size and full brightness, with the reticle (`kind` 1). Pure; tested. */
export function validatorStar(address) {
  return { address, ...placeOf(address), kind: 1, size: 16, bright: 1 };
}

/** The settlements in the last ten minutes, counted per party. Pure; tested. */
export function recentSettlements(settled, { best }) {
  const counts = new Map();
  for (const s of settled) {
    if (settlementAge(s.blockNumber, best) >= SETTLE_FADE_MS) continue;
    for (const party of [s.buyer, s.provider]) counts.set(party, (counts.get(party) ?? 0) + 1);
  }
  return counts;
}

/** How long ago a block was, by its distance from the best block and the slot time. */
export function settlementAge(blockNumber, best) {
  if (!Number.isFinite(best) || !Number.isFinite(blockNumber)) return Infinity;
  return Math.max(0, best - blockNumber) * SLOT_MS;
}

/**
 * Every star: agents first, then validators, capped at MAX_STARS, with an
 * index by address for the lines. Pure; tested.
 */
export function starsFor(agents, validators = [], { best = null, recentSettled = new Map() } = {}) {
  const rows = agents.slice(0, MAX_STARS);
  const activities = rows.map((agent) => activityOf(agent, { best, recentSettled }));
  const maxStake = rows.reduce((max, agent) => Math.max(max, Number(agent.stakePlancks) || 0), 0);
  const maxActivity = activities.reduce((max, a) => Math.max(max, a), 0);
  const stars = rows.map((agent, i) => starOf(agent.address, { stakePlancks: agent.stakePlancks, activity: activities[i] }, { maxStake, maxActivity }));
  for (const address of validators.slice(0, Math.max(0, MAX_STARS - stars.length))) stars.push(validatorStar(address));
  const index = new Map();
  stars.forEach((star, i) => {
    if (!index.has(star.address)) index.set(star.address, i);
  });
  return { stars, index, maxStake, maxActivity };
}

/** An agreement's identity on chain, as the constellation keys it. */
export const lineKey = (buyer, provider, seq) => `${buyer}/${provider}/${seq}`;

/**
 * The lines to draw between stars: one per open agreement (`state` 0, or 1
 * when disputed), then one per settlement of the last ten minutes that is
 * not still open under the same key (`state` 2, `t0` its time). A line whose
 * party is not a star is counted, not drawn: the sky never invents a place.
 * `t0` for a dispute is when this page first saw it disputed (`seen`), so the
 * flicker runs once. Pure; tested.
 */
export function linesFor(open, settled, index, { best = null, now = 0, seen = new Map() } = {}) {
  const lines = [];
  const keys = new Set();
  let omitted = 0;
  for (const a of open) {
    const key = lineKey(a.buyer, a.provider, a.seq);
    keys.add(key);
    const from = index.get(a.buyer);
    const to = index.get(a.provider);
    if (from === undefined || to === undefined) {
      omitted += 1;
      continue;
    }
    const disputed = a.status === 'Disputed';
    let t0 = 0;
    if (disputed) {
      if (!seen.has(key)) seen.set(key, now);
      t0 = seen.get(key);
    }
    lines.push({ key, from, to, state: disputed ? 1 : 0, t0 });
  }
  for (const s of settled) {
    const key = lineKey(s.buyer, s.provider, s.seq);
    if (keys.has(key)) continue;
    keys.add(key);
    const age = settlementAge(s.blockNumber, best);
    if (age >= SETTLE_FADE_MS) continue;
    const from = index.get(s.buyer);
    const to = index.get(s.provider);
    if (from === undefined || to === undefined) {
      omitted += 1;
      continue;
    }
    lines.push({ key, from, to, state: 2, t0: now - age });
  }
  for (const key of seen.keys()) if (!keys.has(key)) seen.delete(key);
  return { lines, omitted };
}

/** The finality marker's place across the field, in clip space: the right edge is now, TRAIL slots back is the left. Pure; tested. */
export function markerX(lag, trail = TRAIL) {
  if (!Number.isFinite(lag)) return 1;
  return 1 - 2 * Math.min(1, Math.max(0, lag) / trail);
}

/** A settlement's glow by its age: steady and low at first, gone after ten minutes. Pure; tested. */
export function settleGlow(ageMs) {
  return Math.min(1, Math.max(0, 1 - ageMs / SETTLE_FADE_MS));
}

/** Whether the last SLOW_SECONDS whole seconds each ran under MIN_FPS. Pure; tested. */
export function fpsTooLow(secondsFps, { minFps = MIN_FPS, run = SLOW_SECONDS } = {}) {
  if (secondsFps.length < run) return false;
  return secondsFps.slice(-run).every((fps) => fps < minFps);
}

/** Mean frames per second and the slowest frame from a list of frame durations in ms. Pure; tested. */
export function frameStats(durations) {
  const frames = durations.length;
  if (frames === 0) return { frames: 0, fps: null, worstMs: null };
  const total = durations.reduce((sum, d) => sum + d, 0);
  return {
    frames,
    fps: total > 0 ? Math.round((frames / total) * 10_000) / 10 : null,
    worstMs: Math.round(Math.max(...durations) * 10) / 10,
  };
}

/** A CSS colour (#rgb, #rrggbb, rgb(), rgba()) as [r, g, b] in 0–1; null when unreadable. Pure; tested. */
export function parseColor(text) {
  const s = String(text ?? '').trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return rgb.slice(1, 4).map((n) => Math.min(1, Number(n) / 255));
  return null;
}

/** Why the sky stands down before it starts, in the footer's words; null when it can start. Pure; tested. */
export function fallbackReason({ webgl, reduced }) {
  if (reduced) return 'no sky: reduced motion is preferred, so the hero stands';
  if (!webgl) return 'no sky: this browser has no WebGL, so the hero stands';
  return null;
}

/** The validator addresses in a `Session.Validators` record. */
export function validatorAddresses(data, field) {
  return decodeValidators(field(data, 'result')).map((key) => encodeSs58(key, SS58_FORMAT));
}

/** The footer's account of what is drawn. Pure; tested. */
export function skyExtra({ validators, lines, omitted, settled, complete }) {
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return (
    `one per registered agent${complete ? '' : ' listed'}, sized by stake, brighter the more recent its activity` +
    `; ${n(validators, 'validator')} as fixed stars (Session.Validators)` +
    `; ${n(lines, 'line')}, one per open agreement (/v1/escrows)${omitted ? `, ${omitted} not drawn: a party is not a registered agent` : ''}` +
    `; ${n(settled, 'settlement')} of the last ten minutes glowing (escrow.DeliveryConfirmed)` +
    `; the field moves once per block and drifts ${DRIFT_DEG_PER_MIN}° a minute`
  );
}

/** The model handed to the scene, so the scene imports nothing of the page's. */
export const model = {
  MAX_STARS,
  TRAIL,
  FRONT_MS,
  FLICKER_MS,
  SETTLE_FADE_MS,
  SLOT_MS,
  DRIFT_DEG_PER_MIN,
  MIN_FPS,
  SLOW_SECONDS,
  WARMUP_MS,
  STATS_WINDOW,
  starsFor,
  linesFor,
  recentSettlements,
  settlementAge,
  markerX,
  settleGlow,
  fpsTooLow,
  frameStats,
  parseColor,
  validatorAddresses,
  skyExtra,
};

function say(note, text) {
  if (!note) return;
  const value = note.querySelector('.reading-value');
  value.textContent = text;
  value.classList.remove('is-loading');
  // The line under it described a read that is no longer drawn.
  note.querySelector('.reading-prov')?.replaceChildren();
}

/** The block height for the presenter's first screen, each digit in a cell as every serif figure on the page. */
function setHeight(node, text) {
  node.replaceChildren();
  const spoken = node.ownerDocument.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = text;
  const cells = node.ownerDocument.createElement('span');
  cells.className = 'dcells';
  cells.setAttribute('aria-hidden', 'true');
  for (const ch of String(text)) {
    if (/\d/.test(ch)) {
      const cell = node.ownerDocument.createElement('span');
      cell.className = 'dc';
      cell.textContent = ch;
      cells.append(cell);
    } else cells.append(ch);
  }
  node.append(spoken, cells);
}

/**
 * Wires the sky when the document carries the flag. Returns a controller
 * (`ready` resolves to the scene, or null when the sky stood down), or null
 * when the flag is off.
 */
export function init(doc, ctx, { search = doc.defaultView?.location?.search, load = () => import('./sky-field.js') } = {}) {
  if (!wantsSky(search)) return null;
  const html = doc.documentElement;
  const win = doc.defaultView;
  const note = doc.querySelector('[data-reading="sky"]');
  if (note) note.hidden = false;

  const probe = doc.createElement('canvas');
  const webgl = Boolean(probe.getContext?.('webgl2') || probe.getContext?.('webgl'));
  const reason = fallbackReason({ webgl, reduced: ctx.motion.reduced() });
  if (reason) {
    say(note, reason);
    return { ready: Promise.resolve(null), reason };
  }

  html.setAttribute('data-sky', '');
  let height = null;
  let onNumber = null;
  if (html.hasAttribute('data-present')) {
    // The first screen: the sky and the live block height, nothing else.
    html.setAttribute('data-sky-present', '');
    height = doc.createElement('p');
    height.className = 'sky-height reading-value';
    height.setAttribute('aria-live', 'off');
    setHeight(height, '—');
    doc.body.append(height);
    onNumber = ({ number }) => {
      if (Number.isFinite(number)) setHeight(height, ctx.format.formatInteger(number));
    };
    ctx.bus.on('head', onNumber);
    ctx.bus.on('poll', onNumber);
  }

  let scene = null;
  const standDown = (why) => {
    html.removeAttribute('data-sky');
    html.removeAttribute('data-sky-present');
    height?.remove();
    say(note, why);
    scene = null;
  };

  const ready = load()
    .then(({ start }) => {
      scene = start({ doc, win, ctx, model, note, onFallback: standDown });
      return scene;
    })
    .catch((error) => {
      standDown(`no sky: it could not start (${error.message}), so the hero stands`);
      return null;
    });
  return { ready, reason: null, scene: () => scene };
}
