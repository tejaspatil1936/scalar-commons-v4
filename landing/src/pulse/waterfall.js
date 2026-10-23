// The Waterfall: Pulse's instrument (brief §5.3). Every registered agent is a
// column, ordered by agent id; time flows down one row per block, newest row
// at the top; each live event is a glyph drawn into the row of its block,
// from model.js's event table and nothing else. Canvas 2D, one draw per
// block (plus the short birth of a row under full motion), paused when the
// tab is hidden, rebuilt from what the index gave on return. Colours are
// read from the tokens at draw time, never written here, so the canvas is
// the same ink as the page. The Ledger has no hue: a glyph's kind is its
// shape (a line with end ticks, a cell, a dashed line, a tick) and its state
// is its ink — live glyphs in --ink, their lines lighter, everything in
// --rule-2 while the index is behind the chain (SITE-ROUND2.md §1.2).
//
// The pure parts — geometry, column order, the glyph for an event, the rail
// labels, the state's alpha — are exported and tested without a canvas.

import { formatInteger } from '../observatory/format.js';
import { isOperatorRun } from '../observatory/instruments/agent-field.js';

/**
 * Desktop: 4 px columns at 1 px gaps, 6 px rows. Mobile: 1 px columns, no gap,
 * 3 px rows. The rail is wide enough for a seven-digit block number at the
 * label size, so its words are never clipped at the field's left edge.
 */
export const DESKTOP = { column: 4, gap: 1, row: 6, rail: 72 };
export const MOBILE = { column: 1, gap: 0, row: 3, rail: 72 };
/** About a hundred rows are visible; the head ticks sit above the first row. */
export const ROWS_VISIBLE = 100;
export const HEAD_HEIGHT = 4;
/** A block number on the rail every tenth row. */
export const RAIL_EVERY = 10;
/** A new row is born at 60 % and warms to full; connecting draws the index's record at 40 %. */
export const BORN_ALPHA = 0.6;
export const CONNECTING_ALPHA = 0.4;
/** The tokens the canvas reads, by name: the Ledger's inks and rules, and the mono face for the rail. */
export const TOKENS = ['paper', 'paper-2', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2', 'font-mono'];
/** A dispute's line is dashed, 2 px on and 2 px off, the hatch's language for a line. */
export const DASH = 2;
/** The kinds that draw a glyph, in the legend's order; `resolved` only ends a dispute's line. */
export const GLYPH_KINDS = ['agreement', 'message', 'settled', 'dispute', 'oracle', 'registered'];

/**
 * The grid for a canvas width: the rail, the column pitch and how many
 * columns fit. Every registered agent is a column: when `count` agents do not
 * fit at the brief's pitch, the gap goes first and then the column narrows
 * (never below 1 px), so no agent is silently left off the right edge.
 */
export function geometry(width, mobile = false, count = 0) {
  const base = mobile ? MOBILE : DESKTOP;
  const room = Math.max(0, width - base.rail);
  let { column, gap } = base;
  if (count > 0 && count * (column + gap) > room) {
    gap = 0;
    if (count * column > room) column = Math.max(1, Math.floor(room / count));
  }
  const pitch = column + gap;
  const columns = Math.max(0, Math.floor(room / pitch));
  return { ...base, column, gap, pitch, columns };
}

/** How many rows fit under the heads. */
export function rowsVisible(height, row) {
  return Math.max(0, Math.floor((height - HEAD_HEIGHT) / row));
}

/** The order of an agent: its numeric id when the index gives one, else its address. */
const orderKey = (agent) => {
  const id = agent?.id ?? agent?.agentId;
  return Number.isFinite(Number(id)) && id !== null && id !== undefined && id !== '' ? [0, Number(id)] : [1, String(agent?.address ?? '')];
};

/**
 * The columns: every agent the index lists, ordered by agent id, each with
 * its name (for the operator-run double head) and its index. Returns the list and a
 * `Map<address, index>`.
 */
export function columnsOf(agents, names = new Map()) {
  const list = (agents ?? [])
    .filter((agent) => typeof agent?.address === 'string')
    .map((agent) => ({ address: agent.address, name: names.get(agent.address) ?? agent.name, key: orderKey(agent) }))
    .sort((a, b) => (a.key[0] - b.key[0]) || (a.key[1] < b.key[1] ? -1 : a.key[1] > b.key[1] ? 1 : 0))
    .map(({ address, name }, index) => ({ address, name, operator: isOperatorRun(name), index }));
  return { list, index: new Map(list.map((c) => [c.address, c.index])) };
}

/**
 * The glyph for a live event: its kind and the columns of its parties (null
 * for a party that is not a column, e.g. a buyer that is not an agent), and
 * the agreement key a dispute line is kept open by.
 */
export function glyphOf({ row, parties }, columns, key = null) {
  const at = (address) => (address && columns.has(address) ? columns.get(address) : null);
  const from = at(parties?.from);
  const to = at(parties?.to);
  if (row.kind === 'resolved') return { kind: 'resolved', from, to, key };
  if (!GLYPH_KINDS.includes(row.kind)) return null;
  return { kind: row.kind, from, to, key };
}

/** The rail prints a block number every tenth block. */
export function railLabel(block, every = RAIL_EVERY) {
  return Number.isFinite(block) && block % every === 0 ? formatInteger(block) : null;
}

/** The alpha the whole field is drawn at in a state. */
export function stateAlpha(state) {
  return state === 'connecting' ? CONNECTING_ALPHA : 1;
}

/**
 * The token a glyph's mark is drawn in: ink for every live mark but a
 * message's cell, which is ink-3; every glyph is rule-2 (a record's outline
 * ink) while the index is behind the chain.
 */
export function glyphToken(kind, state) {
  if (state === 'behind') return 'rule-2';
  return { agreement: 'ink', message: 'ink-3', settled: 'ink', dispute: 'ink', oracle: 'ink', registered: 'ink' }[kind] ?? 'ink-3';
}

/** The token the line between a glyph's two columns is drawn in: a message's rule-2, a payment's ink-3, else the mark's. */
export function lineToken(kind, state) {
  if (state === 'behind') return 'rule-2';
  return { message: 'rule-2', settled: 'ink-3' }[kind] ?? glyphToken(kind, state);
}

/** A column head: ink when the agent joined in the window, a double tick when operator-run, a rule-2 tick otherwise. */
export function headOf({ joined = false, operator = false }, state) {
  if (state === 'behind') return { token: 'rule-2', double: operator };
  return { token: joined ? 'ink' : operator ? 'ink-3' : 'rule-2', double: operator };
}

/** Reads the tokens off :root, at draw time, the way the observatory's theme does. */
export function readTokens(win) {
  const style = win.getComputedStyle(win.document.documentElement);
  const out = {};
  for (const name of TOKENS) out[name] = style.getPropertyValue(`--${name}`).trim();
  out.shift = parseFloat(style.getPropertyValue('--t-shift')) || 240;
  out.cool = parseFloat(style.getPropertyValue('--t-cool')) || 1800;
  return out;
}

/** The sentence under the field is the feed's; the canvas carries no words but the rail's numbers. */
export function createWaterfall(canvas, { ctx, win = window }) {
  const motion = ctx.motion;
  let box = { width: 1, height: 1 };
  let geo = geometry(1);
  let columns = { list: [], index: new Map() };
  let names = new Map();
  const rows = []; // newest first: { block, glyphs: [] }
  const disputes = new Map(); // agreement key -> { from, to } while open
  const joined = new Set(); // addresses whose head is lit (joined in the window)
  let state = 'connecting';
  let paused = win.document?.hidden ?? false;
  let shift = 0; // px the rows are still displaced by while a birth settles
  let born = 1; // alpha of the newest row
  let cancel = () => {};
  let context = null;
  let tokens = null;

  const getBox = ctx.fitCanvas(canvas, (next) => {
    box = next;
    context = next.context;
    layout();
    draw();
  });
  box = getBox();
  context = box.context;

  function layout() {
    geo = geometry(box.width, win.matchMedia?.('(max-width: 480px)')?.matches ?? false, columns.list.length);
  }

  const x = (column) => geo.rail + column * geo.pitch;
  const mid = (column) => x(column) + geo.column / 2;

  function drawLine(a, b, y, color, { dashed = false } = {}) {
    if (a === null || b === null || a === b) return;
    context.fillStyle = color;
    const left = Math.min(mid(a), mid(b));
    const right = Math.max(mid(a), mid(b));
    if (!dashed) {
      context.fillRect(left, y, right - left, 1);
      return;
    }
    // In dispute: the hatch's language for a line, 2 px of ink and 2 px of paper.
    for (let at = left; at < right; at += 2 * DASH) context.fillRect(at, y, Math.min(DASH, right - at), 1);
  }

  function drawGlyph(glyph, y, rowAlpha) {
    const { kind, from, to } = glyph;
    const color = tokens[glyphToken(kind, state)];
    const line = tokens[lineToken(kind, state)];
    const scale = geo.row / DESKTOP.row;
    const cy = y + Math.floor(geo.row / 2);
    context.globalAlpha = rowAlpha;
    switch (kind) {
      case 'agreement': {
        // A 1 px ink line between the two columns, with 3 px ticks at its ends.
        drawLine(from, to, cy, line);
        context.fillStyle = color;
        for (const end of [from, to]) {
          if (end !== null) context.fillRect(mid(end), cy - 1, 1, 3);
        }
        break;
      }
      case 'message': {
        // A 4×4 ink-3 cell at the sender, a 1 px rule-2 line to the recipient.
        drawLine(from, to, cy, line);
        if (from !== null) {
          context.fillStyle = color;
          context.fillRect(x(from), y, geo.column, Math.max(1, Math.round(4 * scale)));
        }
        break;
      }
      case 'settled': {
        // Work paid for: a 4×6 ink cell at the provider, the line between the two in ink-3.
        drawLine(from, to, cy, line);
        if (to !== null) {
          context.fillStyle = color;
          context.fillRect(x(to), y, geo.column, geo.row);
        }
        break;
      }
      case 'dispute':
        // Repeated on every row until it settles (rowFor carries it down).
        drawLine(from, to, cy, line, { dashed: true });
        break;
      case 'oracle':
        if (from !== null) {
          context.fillStyle = color;
          context.fillRect(mid(from), y, 1, Math.max(2, Math.round(12 * scale)));
        }
        break;
      default:
        break;
    }
    context.globalAlpha = 1;
  }

  function drawHeads() {
    for (const column of columns.list) {
      if (column.index >= geo.columns) break;
      const head = headOf({ joined: joined.has(column.address), operator: column.operator }, state);
      context.fillStyle = tokens[head.token];
      context.fillRect(x(column.index), 0, geo.column, 1);
      // Operator-run: the double outline's language for a tick, a second line 1 px below a gap.
      if (head.double) context.fillRect(x(column.index), 2, geo.column, 1);
    }
  }

  function drawRail(y, block) {
    const label = railLabel(block);
    if (label === null) return;
    context.fillStyle = tokens['rule-2'];
    context.fillRect(geo.rail - 8, y, 4, 1);
    context.fillStyle = tokens['ink-3'];
    // The --label style: IBM Plex Mono 500 at 11 px.
    context.font = `500 11px ${tokens['font-mono'] || 'monospace'}`;
    context.textBaseline = 'top';
    context.textAlign = 'right';
    context.fillText(label, geo.rail - 12, y - 4);
  }

  function draw() {
    if (paused || !context) return;
    tokens = readTokens(win);
    context.clearRect(0, 0, box.width, box.height);
    context.globalAlpha = stateAlpha(state);
    drawHeads();
    const visible = rowsVisible(box.height, geo.row) + 1;
    for (let i = 0; i < rows.length && i < visible; i += 1) {
      const row = rows[i];
      const y = HEAD_HEIGHT + i * geo.row + shift;
      const alpha = (i === 0 ? born : 1) * stateAlpha(state);
      drawRail(y, row.block);
      for (const glyph of row.glyphs) drawGlyph(glyph, y, alpha);
    }
    context.globalAlpha = 1;
  }

  /** A row for a block: the one that exists, or new rows down to it. */
  function rowFor(block) {
    if (!Number.isFinite(block)) return null;
    const newest = rows[0]?.block ?? null;
    if (newest === null || block > newest) {
      const from = newest === null ? block : newest + 1;
      for (let b = from; b <= block; b += 1) {
        rows.unshift({ block: b, glyphs: [...disputes.entries()].map(([key, { from: f, to }]) => ({ kind: 'dispute', from: f, to, key })) });
      }
      while (rows.length > ROWS_VISIBLE + 2) rows.pop();
      return rows[0];
    }
    return rows.find((row) => row.block === block) ?? null;
  }

  function settle() {
    cancel();
    if (motion.reduced()) {
      shift = 0;
      born = 1;
      draw();
      return;
    }
    const { shift: shiftMs, cool } = readTokens(win);
    shift = -geo.row;
    born = BORN_ALPHA;
    cancel = motion.tween(Math.max(shiftMs, cool), (t) => {
      const settled = Math.min(1, (t * Math.max(shiftMs, cool)) / shiftMs);
      shift = -geo.row * (1 - settled);
      born = BORN_ALPHA + (1 - BORN_ALPHA) * t;
      draw();
    }, { ease: (t) => t });
  }

  return {
    /** The agents the index lists; the columns are rebuilt and the field redrawn once. */
    setAgents(items, nextNames = names) {
      names = nextNames;
      columns = columnsOf(items, names);
      layout();
      draw();
    },
    /** A new block: one row is born at the top (and the open disputes continue into it). */
    block(number) {
      const before = rows[0]?.block ?? null;
      rowFor(number);
      if (rows[0]?.block !== before) settle();
      else draw();
    },
    /** A live event, as the feed hands it on: drawn into the row of its block. */
    event(live) {
      const block = Number(live.event?.blockNumber);
      const row = rowFor(block);
      const key = live.key ?? null;
      const glyph = glyphOf(live, columns.index, key);
      if (!row || !glyph) return;
      if (glyph.kind === 'registered') joined.add(live.parties.from);
      if (glyph.kind === 'dispute' && key) disputes.set(key, { from: glyph.from, to: glyph.to });
      if (glyph.kind === 'resolved') {
        if (key) disputes.delete(key);
        return;
      }
      row.glyphs.push(glyph);
      draw();
    },
    setState(next) {
      if (next === state) return;
      state = next;
      draw();
    },
    pause() {
      paused = true;
      cancel();
    },
    resume() {
      paused = false;
      shift = 0;
      born = 1;
      layout();
      draw();
    },
    rebuild: draw,
    rows: () => rows,
    state: () => state,
  };
}

/** The legend's glyph, drawn small (24×12) in the same ink. */
export function drawLegendGlyph(canvas, kind, win = window) {
  const context = canvas.getContext?.('2d');
  if (!context) return;
  const tokens = readTokens(win);
  const w = canvas.width;
  const h = canvas.height;
  context.clearRect(0, 0, w, h);
  const color = tokens[glyphToken(kind, 'live')];
  const line = tokens[lineToken(kind, 'live')];
  const cy = Math.floor(h / 2);
  switch (kind) {
    case 'agreement':
      context.fillStyle = line;
      context.fillRect(4, cy, w - 8, 1);
      context.fillStyle = color;
      context.fillRect(4, cy - 1, 1, 3);
      context.fillRect(w - 5, cy - 1, 1, 3);
      break;
    case 'message':
      context.fillStyle = line;
      context.fillRect(4, cy, w - 8, 1);
      context.fillStyle = color;
      context.fillRect(4, cy - 2, 4, 4);
      break;
    case 'settled':
      context.fillStyle = line;
      context.fillRect(4, cy, w - 8, 1);
      context.fillStyle = color;
      context.fillRect(w - 8, cy - 3, 4, 6);
      break;
    case 'dispute':
      context.fillStyle = line;
      for (let at = 4; at < w - 4; at += 2 * DASH) context.fillRect(at, cy, DASH, 1);
      break;
    case 'oracle':
      context.fillStyle = color;
      context.fillRect(Math.floor(w / 2), 0, 1, h);
      break;
    case 'registered':
      // The head printed in ink: a 4 px tick on a rule-2 run of other heads.
      context.fillStyle = tokens['rule-2'];
      context.fillRect(4, cy, w - 8, 1);
      context.fillStyle = color;
      context.fillRect(Math.floor(w / 2) - 2, cy, 4, 1);
      break;
    default:
      break;
  }
}
