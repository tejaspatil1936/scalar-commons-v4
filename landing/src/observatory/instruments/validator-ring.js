// 04 · Validator ring. The active validator set as points on a hairline
// ring, chords between them, and the two things a public node can honestly
// say about each validator: which one sealed each block as it arrives, and
// whether its finality vote was seen in the rounds sampled while this page
// has been open. The health of the one node the page reads from sits beside
// it, because that is the only node whose peer count and sync state the
// public RPC reports.
//
// Data: `Session.Validators`, `Session.QueuedKeys` and `Babe.Authorities`
// read raw off the node every minute and decoded here (../scale.js); the
// block author is decoded from each header's BABE pre-digest as it arrives
// (the hero emits `head` on the page bus; on its own, in the harness, the
// ring subscribes itself); `grandpa_roundState` every 6 s for the finality
// vote sample; `system_health` every 30 s for the node.
//
// Motion: a halo expands and fades once around the point that sealed a block;
// a validator's vote arc tweens to its new length when a sample changes it.
// Nothing moves between data changes.

import { decodeValidators, decodeQueuedKeys, decodeBabeAuthorities, bytesToHex, babePreDigestOf } from '../scale.js';
import { encodeSs58 } from '../ss58.js';

const SET_INTERVAL_MS = 60_000;
const HEALTH_INTERVAL_MS = 30_000;
const GRANDPA_INTERVAL_MS = 6_000;
const HALO_MS = 700;
const REDUCED_LIT_MS = 1_000;
const ARC_MS = 200;
/** Samples a vote arc needs before it is drawn: fewer would show noise, not participation. */
export const MIN_SAMPLES = 3;
/** Above this many validators the ring draws only neighbouring chords; every pair would be a disc. */
export const ALL_CHORDS_UP_TO = 12;
export const SS58_FORMAT = 42;

/** The SVG's coordinate space: a 320-unit square; the ring scales to its box. */
export const SIZE = 320;
export const CENTRE = SIZE / 2;
export const RADIUS = 108;
export const POINT_R = 7;
export const VOTES_R = 13; // the small vote arc around each point
export const TICK_FROM = RADIUS + 11; // hairline from the point outward to its label
export const TICK_TO = RADIUS + 17;
export const LABEL_R = RADIUS + 24;

// ── pure helpers (unit-tested) ────────────────────────────────────────────────

const fix = (n) => Number(n.toFixed(3));

/** A point at `angle` radians (0 at three o'clock, clockwise positive in SVG). */
export function pointAt(angle, r, cx = CENTRE, cy = CENTRE) {
  return { x: fix(cx + r * Math.cos(angle)), y: fix(cy + r * Math.sin(angle)) };
}

/** `count` positions evenly spaced around the ring, the first at twelve o'clock, clockwise. */
export function ringPositions(count, r = RADIUS, cx = CENTRE, cy = CENTRE) {
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const angle = -Math.PI / 2 + (count > 0 ? (k / count) * 2 * Math.PI : 0);
    out.push({ index: k, angle, ...pointAt(angle, r, cx, cy) });
  }
  return out;
}

/**
 * Which pairs of the first `count` points are joined by a chord: every pair
 * up to ALL_CHORDS_UP_TO points (n(n−1)/2 of them), neighbours only above.
 */
export function chordPairs(count) {
  const pairs = [];
  if (count < 2) return pairs;
  if (count <= ALL_CHORDS_UP_TO) {
    for (let i = 0; i < count; i += 1) for (let j = i + 1; j < count; j += 1) pairs.push([i, j]);
    return pairs;
  }
  for (let i = 0; i < count; i += 1) pairs.push([i, (i + 1) % count]);
  return pairs;
}

/** Where a label sits relative to its point: text-anchor by side of the ring. */
export function labelAnchor(angle) {
  const c = Math.cos(angle);
  if (c > 0.2) return 'start';
  if (c < -0.2) return 'end';
  return 'middle';
}

/**
 * The SVG path of a small arc around a point, from the point's own twelve
 * o'clock clockwise, covering `fraction` of a full turn.
 */
export function votesArcPath(fraction, cx, cy, r = VOTES_R) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  if (f <= 0) return '';
  const start = -Math.PI / 2;
  const a = pointAt(start, r, cx, cy);
  if (f >= 1 - 1e-9) {
    const b = pointAt(start + Math.PI, r, cx, cy);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${b.x} ${b.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`;
  }
  const b = pointAt(start + f * 2 * Math.PI, r, cx, cy);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/**
 * The validator set as the ring shows it, from the three decoded storage
 * values. `validators` is Session.Validators (stash keys), `queued` is
 * Session.QueuedKeys, `babe` is Babe.Authorities. Any of the last two may be
 * null when its read failed: the set is still drawn, and authorship or votes
 * are then reported as unmappable rather than guessed.
 */
export function buildSet({ validators, queued = null, babe = null }) {
  const keysByStash = new Map();
  for (const entry of queued ?? []) {
    keysByStash.set(bytesToHex(entry.stash), {
      babeHex: bytesToHex(entry.babe),
      grandpaAddress: encodeSs58(entry.grandpa, SS58_FORMAT),
    });
  }
  const active = validators.map((key, index) => {
    const stashHex = bytesToHex(key);
    const keys = keysByStash.get(stashHex) ?? null;
    return {
      index,
      stashHex,
      address: encodeSs58(key, SS58_FORMAT),
      babeHex: keys?.babeHex ?? null,
      grandpaAddress: keys?.grandpaAddress ?? null,
      queued: false,
    };
  });
  const activeHex = new Set(active.map((v) => v.stashHex));
  const joining = [];
  for (const entry of queued ?? []) {
    const stashHex = bytesToHex(entry.stash);
    if (activeHex.has(stashHex) || joining.some((v) => v.stashHex === stashHex)) continue;
    joining.push({
      index: active.length + joining.length,
      stashHex,
      address: encodeSs58(entry.stash, SS58_FORMAT),
      babeHex: bytesToHex(entry.babe),
      grandpaAddress: encodeSs58(entry.grandpa, SS58_FORMAT),
      queued: true,
    });
  }
  // BABE authority index → stash, through the babe key each stash queued.
  const stashByBabe = new Map([...active, ...joining].map((v) => [v.babeHex, v.stashHex]));
  const authorities = (babe ?? []).map((entry) => stashByBabe.get(bytesToHex(entry.key)) ?? null);
  return { active, queued: joining, authorities };
}

/**
 * The stash (hex) that sealed a block, from the BABE authority index in its
 * pre-digest; null when the index is beyond the authority list or its key is
 * not in the queued session keys.
 */
export function stashForAuthority(authorityIndex, authorities) {
  if (!Number.isInteger(authorityIndex) || authorityIndex < 0 || authorityIndex >= authorities.length) return null;
  return authorities[authorityIndex] ?? null;
}

/**
 * The finality-vote sample. Each `grandpa_roundState` read names the round in
 * progress and, for each of its two votes (prevote and precommit), the voters
 * whose vote has NOT arrived yet. A round is counted once however many times
 * it is sampled, and a validator is "seen" in a round if any sample of it
 * found either of its votes present. Rounds turn over faster than the sample
 * (about one a second against one read every 6 s) and a sample can land
 * before a validator has voted, which is why this is a sample and never a
 * percentage of all rounds.
 */
export class VoteSampler {
  constructor() {
    this.rounds = new Map(); // round → { ids: Set (in the set at the time), seen: Set }
  }

  /**
   * Records one sample. `missing` holds the `prevotes.missing` and
   * `precommits.missing` lists of the round; `ids` are the grandpa addresses
   * of the active validators (null for one whose key is unknown).
   */
  add(round, { prevotes, precommits }, ids) {
    if (!Number.isInteger(round)) throw new Error('round is not an integer');
    if (!Array.isArray(prevotes) || !Array.isArray(precommits)) throw new Error('missing is not a list');
    // A sample taken before any validator's grandpa key is known can be
    // attributed to nobody, so it is not a sampled round.
    if (!ids.some((id) => id !== null && id !== undefined)) return;
    let entry = this.rounds.get(round);
    if (!entry) {
      entry = { ids: new Set(), seen: new Set() };
      this.rounds.set(round, entry);
    }
    const noPrevote = new Set(prevotes.map(String));
    const noPrecommit = new Set(precommits.map(String));
    for (const id of ids) {
      if (id === null || id === undefined) continue;
      entry.ids.add(id);
      if (!noPrevote.has(id) || !noPrecommit.has(id)) entry.seen.add(id);
    }
  }

  roundsSampled() {
    return this.rounds.size;
  }

  /** `{ seen, sampled }` for one grandpa address: rounds it was seen voting in, of rounds sampled while it was in the set. */
  countsFor(id) {
    let seen = 0;
    let sampled = 0;
    for (const entry of this.rounds.values()) {
      if (!entry.ids.has(id)) continue;
      sampled += 1;
      if (entry.seen.has(id)) seen += 1;
    }
    return { seen, sampled };
  }
}

/** "sealed 3 blocks since you opened this page · last #820,715", or the honest nothing. */
export function sealedPhrase(sealed, formatInteger) {
  if (!sealed || sealed.count === 0) return 'no block sealed since you opened this page';
  return `sealed ${formatInteger(sealed.count)} block${sealed.count === 1 ? '' : 's'} since you opened this page · last #${formatInteger(sealed.last)}`;
}

/** "GRANDPA votes seen in 4 of 5 rounds sampled since you opened this page". */
export function votesPhrase(counts, formatInteger) {
  if (!counts || counts.sampled === 0) return 'no GRANDPA round sampled yet';
  return `GRANDPA votes seen in ${formatInteger(counts.seen)} of ${formatInteger(counts.sampled)} round${counts.sampled === 1 ? '' : 's'} sampled since you opened this page`;
}

/** The one-sentence summary the ring's aria-label carries. */
export function ariaSummary({ active, queued, lastAuthor }) {
  const n = active;
  const parts = [`${n} validator${n === 1 ? '' : 's'} in the active set`];
  if (lastAuthor !== null && lastAuthor !== undefined) parts.push(`validator ${lastAuthor} sealed the latest block`);
  if (queued > 0) parts.push(`${queued} joining next session`);
  return parts.join('; ');
}

// ── the instrument ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, className = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (className) node.setAttribute('class', className);
  return node;
}

function html(name, className = '', text = '') {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function headerNumber(header) {
  const n = header?.number;
  if (typeof n === 'string' && /^0x[0-9a-f]+$/i.test(n)) return parseInt(n, 16);
  if (typeof n === 'number') return n;
  throw new Error('header has no block number');
}

export function init(root, ctx) {
  const svg = root.querySelector('svg.ring');
  const list = root.querySelector('.validator-list');
  const note = root.querySelector('.ring-note');
  const targets = {
    validators: ctx.reading('validators', root),
    health: ctx.reading('nodeHealth', root),
  };
  const { formatInteger, shortAddress, utcTime } = ctx.format;

  if (note) {
    note.textContent =
      'Authorship is decoded from each block’s BABE pre-digest as it arrives; GRANDPA participation is sampled from grandpa_roundState every 6 s and is a sample, not a count of every round: rounds turn over faster than the sample, and a validator counts as seen in a sampled round if either of its two votes (prevote or precommit) had arrived when the sample was taken. A validator’s own peer count and sync state are not exposed by a public RPC, so they are not shown.';
  }

  // A status line for the parts of the picture that have no reading slot of
  // their own: the session keys, the authority list and the vote sample.
  const status = html('p', 'instrument-note ring-status');
  status.hidden = true;
  list?.after(status);

  // ── model ──
  const records = { validators: null, queued: null, babe: null };
  let set = null; // buildSet() output, or null while the validator set is unknown
  let setKey = ''; // signature of the drawn set, to rebuild only on change
  const sealed = new Map(); // stashHex → { count, last }
  const unmapped = new Map(); // authorityIndex → { count, last, reason }
  const sampler = new VoteSampler();
  let grandpaRecord = null;
  let lastAuthor = null; // 1-based position of the last block's author, or null
  let lastHead = null;
  const nodes = new Map(); // stashHex → { g, point, halo, votes, label, li, meta, fraction, cancel }
  let unmappedLi = new Map(); // authorityIndex → li
  let cancelHalo = () => {};
  let litTimer = null;

  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);

  // ── drawing ──
  function drawUnavailable(reason) {
    nodes.clear();
    setKey = '';
    svg.replaceChildren();
    svg.dataset.state = 'unavailable';
    svg.append(el('circle', { cx: CENTRE, cy: CENTRE, r: RADIUS }, 'ring-track'));
    const centre = el('text', { x: CENTRE, y: CENTRE + 18 }, 'ring-centre');
    centre.textContent = '—';
    const caption = el('text', { x: CENTRE, y: CENTRE + 42 }, 'ring-caption');
    caption.textContent = 'ACTIVE VALIDATORS';
    svg.append(centre, caption);
    svg.setAttribute('aria-label', `The active validator set is unavailable: ${reason}`);
    if (list) {
      list.replaceChildren();
      const li = html('li', 'v-unavailable');
      li.append(html('span', 'v-index', '—'), html('span', 'v-meta', `unavailable — ${reason}`));
      list.append(li);
    }
  }

  function buildRing() {
    const all = [...set.active, ...set.queued];
    const positions = ringPositions(all.length);
    nodes.clear();
    svg.replaceChildren();
    svg.dataset.state = 'live';
    svg.append(el('circle', { cx: CENTRE, cy: CENTRE, r: RADIUS }, 'ring-track'));

    const chords = el('g', {}, 'ring-chords');
    for (const [i, j] of chordPairs(set.active.length)) {
      const a = positions[i];
      const b = positions[j];
      chords.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 'ring-chord'));
    }
    svg.append(chords);

    const centre = el('text', { x: CENTRE, y: CENTRE + 18 }, 'ring-centre');
    centre.textContent = formatInteger(set.active.length);
    const caption = el('text', { x: CENTRE, y: CENTRE + 42 }, 'ring-caption');
    caption.textContent = 'ACTIVE VALIDATORS';
    svg.append(centre, caption);

    const points = el('g', {}, 'ring-points');
    for (const validator of all) {
      const p = positions[validator.index];
      const g = el('g', { 'data-index': validator.index + 1 }, `ring-node${validator.queued ? ' is-queued' : ''}`);
      const halo = el('circle', { cx: p.x, cy: p.y, r: POINT_R }, 'ring-halo');
      const votes = el('path', { d: '' }, 'ring-votes');
      const point = el('circle', { cx: p.x, cy: p.y, r: POINT_R }, `ring-point${validator.queued ? ' is-queued' : ''}`);
      const from = pointAt(p.angle, TICK_FROM);
      const to = pointAt(p.angle, TICK_TO);
      const tick = el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y }, 'ring-tick');
      const at = pointAt(p.angle, LABEL_R);
      const s = Math.sin(p.angle);
      const label = el('text', { x: at.x, y: at.y + (s > 0.6 ? 10 : s < -0.6 ? -2 : 4), 'text-anchor': labelAnchor(p.angle) }, 'ring-label');
      const num = el('tspan', {}, 'ring-label-index');
      num.textContent = String(validator.index + 1);
      const addr = el('tspan', { x: at.x, dy: 12 }, 'ring-label-addr');
      addr.textContent = validator.queued ? 'joining next session' : shortAddress(validator.address);
      label.append(num, addr);
      g.append(halo, votes, point, tick, label);
      points.append(g);
      nodes.set(validator.stashHex, { validator, g, point, halo, votes, label, fraction: 0, cancel: () => {} });
    }
    svg.append(points);
    buildList(all);
    drawVotes();
    updateAria();
  }

  function buildList(all) {
    if (!list) return;
    list.replaceChildren();
    unmappedLi = new Map();
    for (const validator of all) {
      const li = html('li', validator.queued ? 'is-queued' : '');
      li.append(html('span', 'v-index', String(validator.index + 1)));
      const addr = html('span', 'v-addr');
      const a = html('a', 'mono', shortAddress(validator.address));
      a.href = `${ctx.EXPLORER_ORIGIN}/account/${validator.address}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = validator.address;
      addr.append(a);
      if (validator.queued) addr.append(' ', html('span', 'v-mark', 'joining next session'));
      const meta = html('span', 'v-meta');
      li.append(addr, meta);
      list.append(li);
      const node = nodes.get(validator.stashHex);
      if (node) {
        node.li = li;
        node.meta = meta;
      }
    }
    for (const [index, entry] of unmapped) appendUnmapped(index, entry);
    drawMeta();
  }

  function appendUnmapped(index, entry) {
    if (!list) return;
    const li = html('li', 'is-unmapped');
    li.append(html('span', 'v-index', '?'));
    li.append(html('span', 'v-addr mono', `authority #${index} (${entry.reason})`));
    const meta = html('span', 'v-meta');
    li.append(meta);
    list.append(li);
    unmappedLi.set(index, { li, meta });
  }

  function drawMeta() {
    const failed = grandpaRecord && !grandpaRecord.ok ? ` · latest GRANDPA sample failed: ${grandpaRecord.error}` : '';
    for (const node of nodes.values()) {
      if (!node.meta) continue;
      const { validator } = node;
      if (validator.queued) {
        node.meta.textContent = 'queued for the next session — not yet sealing blocks or voting';
        continue;
      }
      const seal = sealedPhrase(sealed.get(validator.stashHex), formatInteger);
      const votes = validator.grandpaAddress
        ? votesPhrase(sampler.countsFor(validator.grandpaAddress), formatInteger)
        : 'GRANDPA key not in queued keys, so votes cannot be attributed';
      node.meta.textContent = `${seal} · ${votes}${failed}`;
    }
    for (const [index, { meta }] of unmappedLi) {
      meta.textContent = sealedPhrase(unmapped.get(index), formatInteger);
    }
  }

  function drawVotes() {
    for (const node of nodes.values()) {
      const { validator } = node;
      if (validator.queued || !validator.grandpaAddress) continue;
      const counts = sampler.countsFor(validator.grandpaAddress);
      const to = counts.sampled >= MIN_SAMPLES ? counts.seen / counts.sampled : 0;
      if (to === node.fraction) continue;
      node.cancel();
      const from = node.fraction;
      const cx = Number(node.point.getAttribute('cx'));
      const cy = Number(node.point.getAttribute('cy'));
      node.cancel = ctx.motion.tween(ARC_MS, (t) => {
        node.fraction = from + (to - from) * t;
        node.votes.setAttribute('d', votesArcPath(node.fraction, cx, cy));
      });
    }
  }

  function updateAria() {
    if (!set) return;
    svg.setAttribute('aria-label', ariaSummary({ active: set.active.length, queued: set.queued.length, lastAuthor }));
  }

  function light(node) {
    cancelHalo();
    clearTimeout(litTimer);
    for (const other of nodes.values()) other.g.classList.remove('is-authoring');
    node.g.classList.add('is-authoring');
    const cx = node.point.getAttribute('cx');
    const cy = node.point.getAttribute('cy');
    if (ctx.motion.reduced()) {
      node.halo.setAttribute('opacity', '0');
      litTimer = setTimeout(() => node.g.classList.remove('is-authoring'), REDUCED_LIT_MS);
      return;
    }
    node.halo.setAttribute('cx', cx);
    node.halo.setAttribute('cy', cy);
    cancelHalo = ctx.motion.tween(HALO_MS, (t) => {
      node.halo.setAttribute('r', String(POINT_R + 22 * t));
      node.halo.setAttribute('opacity', String(0.9 * (1 - t)));
    }, {
      done: () => {
        node.halo.setAttribute('opacity', '0');
        node.g.classList.remove('is-authoring');
      },
    });
  }

  // ── status line ──
  function drawStatus() {
    const lines = [];
    if (records.queued && !records.queued.ok) lines.push(`Session keys unavailable (${records.queued.label}): ${records.queued.error} — blocks cannot be attributed to a validator.`);
    if (records.babe && !records.babe.ok) lines.push(`Authority list unavailable (${records.babe.label}): ${records.babe.error} — blocks cannot be attributed to a validator.`);
    if (grandpaRecord) {
      if (grandpaRecord.ok) {
        try {
          const round = ctx.field(grandpaRecord.data, 'result.best.round');
          const total = ctx.field(grandpaRecord.data, 'result.best.totalWeight');
          const threshold = ctx.field(grandpaRecord.data, 'result.best.thresholdWeight');
          lines.push(
            `GRANDPA (finality) vote round ${formatInteger(round)} sampled at ${utcTime(grandpaRecord.at)} · ${formatInteger(threshold)} of ${formatInteger(total)} votes make a block final · ${formatInteger(sampler.roundsSampled())} round${sampler.roundsSampled() === 1 ? '' : 's'} sampled since you opened this page.`,
          );
        } catch (error) {
          lines.push(`GRANDPA sample could not be read: ${error.message}`);
        }
      } else {
        lines.push(`GRANDPA sample unavailable (${grandpaRecord.label}): ${grandpaRecord.error}`);
      }
    }
    status.textContent = lines.join(' ');
    status.hidden = lines.length === 0;
  }

  // ── data ──
  function rebuild() {
    const record = records.validators;
    if (!record) return;
    const ok = ctx.readout.apply(targets.validators, record, (data) => {
      const validators = decodeValidators(ctx.field(data, 'result'));
      let queued = null;
      let babe = null;
      if (records.queued?.ok) {
        try {
          queued = decodeQueuedKeys(ctx.field(records.queued.data, 'result'));
        } catch (error) {
          records.queued = { ...records.queued, ok: false, error: error.message };
        }
      }
      if (records.babe?.ok) {
        try {
          babe = decodeBabeAuthorities(ctx.field(records.babe.data, 'result'));
        } catch (error) {
          records.babe = { ...records.babe, ok: false, error: error.message };
        }
      }
      set = buildSet({ validators, queued, babe });
      const extra = set.queued.length
        ? `${formatInteger(set.queued.length)} more joining next session`
        : queued
          ? 'none queued to join'
          : '';
      ctx.readout.showValue(targets.validators, record, { value: set.active.length, motion: ctx.motion, extra });
      const key = [...set.active, ...set.queued].map((v) => `${v.stashHex}:${v.queued ? 'q' : 'a'}:${v.grandpaAddress ?? ''}`).join('|');
      if (key !== setKey) {
        setKey = key;
        buildRing();
      }
    });
    if (!ok) {
      set = null;
      drawUnavailable(record.error ?? 'the validator set could not be decoded');
    }
    drawStatus();
  }

  function onGrandpa(record) {
    grandpaRecord = record;
    if (record.ok && set) {
      try {
        const round = ctx.field(record.data, 'result.best.round');
        const prevotes = ctx.field(record.data, 'result.best.prevotes.missing');
        const precommits = ctx.field(record.data, 'result.best.precommits.missing');
        sampler.add(round, { prevotes, precommits }, set.active.map((v) => v.grandpaAddress));
      } catch (error) {
        grandpaRecord = { ...record, ok: false, error: error.message };
      }
    }
    drawVotes();
    drawMeta();
    drawStatus();
  }

  function onHealth(record) {
    ctx.readout.apply(targets.health, record, (data) => {
      const peers = ctx.field(data, 'result.peers');
      const syncing = ctx.field(data, 'result.isSyncing');
      ctx.readout.showValue(targets.health, record, {
        value: peers,
        unit: peers === 1 ? ' peer' : ' peers',
        extra: syncing === true ? 'catching up' : 'synced',
        motion: ctx.motion,
      });
    });
  }

  function onHead({ number, author }) {
    if (!set || number === lastHead) return;
    lastHead = number;
    if (!author) return; // no BABE pre-digest on this header: nothing to attribute
    if (author.error) {
      status.hidden = false;
      status.textContent = `Block #${formatInteger(number)}: its author could not be decoded — ${author.error}`;
      return;
    }
    const stashHex = stashForAuthority(author.authorityIndex, set.authorities);
    const node = stashHex ? nodes.get(stashHex) : null;
    if (!node) {
      const reason = !records.queued?.ok || !records.babe?.ok ? 'session keys unavailable' : 'not in queued keys';
      const entry = unmapped.get(author.authorityIndex) ?? { count: 0, last: null, reason };
      entry.count += 1;
      entry.last = number;
      entry.reason = reason;
      unmapped.set(author.authorityIndex, entry);
      if (!unmappedLi.has(author.authorityIndex)) appendUnmapped(author.authorityIndex, entry);
      lastAuthor = null;
      drawMeta();
      updateAria();
      return;
    }
    const entry = sealed.get(stashHex) ?? { count: 0, last: null };
    entry.count += 1;
    entry.last = number;
    sealed.set(stashHex, entry);
    lastAuthor = node.validator.index + 1;
    light(node);
    drawMeta();
    updateAria();
  }

  ctx.watch('validators', (record) => { records.validators = record; rebuild(); }, SET_INTERVAL_MS);
  ctx.watch('queuedKeys', (record) => { records.queued = record; rebuild(); }, SET_INTERVAL_MS);
  ctx.watch('babeAuthorities', (record) => { records.babe = record; rebuild(); }, SET_INTERVAL_MS);
  ctx.watch('health', onHealth, HEALTH_INTERVAL_MS);
  ctx.watch('grandpa', onGrandpa, GRANDPA_INTERVAL_MS);

  ctx.bus.on('head', onHead);
  // On its own (the harness), with no hero to emit `head`, the ring listens to
  // new heads itself and decodes the author the same way the hero does.
  if (!root.ownerDocument.querySelector('[data-instrument="pulse"]')) {
    ctx.subscribe('newHeads', (record) => {
      try {
        const header = record.data;
        let author = null;
        try {
          author = babePreDigestOf(header);
        } catch (error) {
          author = { error: error.message };
        }
        onHead({ record, number: headerNumber(header), header, author, forked: false });
      } catch (error) {
        console.error(error);
      }
    });
  }
}
