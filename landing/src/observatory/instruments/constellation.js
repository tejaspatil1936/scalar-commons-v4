// 03 · Agent constellation. Every registered agent is a point on the plate,
// sized by the square root of its stake; every agreement between two of them
// is a line — open ones in the active colour, disputed ones heavier in the
// dispute colour, recently settled ones dashed in the settled colour. A party
// to a line that is no longer in the agent list is drawn as a small hollow
// point and said to be so.
//
// Data: /v1/agents (live chain state, read whole), /v1/escrows (the open
// agreements, live chain state, read whole) and the most recent
// escrow.DeliveryConfirmed events from the finalized-block index for the
// settled lines. The readings beside the plate come from /v1/escrows/stats,
// from the agents.SlashExecuted events since the era's first block, and —
// once runtime 309 is in force — from the messages.MessageSent events.
//
// Motion: the force layout settles once when the graph first appears (a
// bounded run: d3-force stops itself as alpha decays) and is reheated only
// when agents join or leave. A new line draws itself in from buyer to
// provider over 400 ms, a line whose status became disputed pulses once, a
// line that has gone fades out over 400 ms. Nothing else moves, and under
// prefers-reduced-motion the layout is computed synchronously and drawn once.

import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';

const AGENTS_INTERVAL_MS = 60_000;
const ESCROWS_INTERVAL_MS = 30_000;
const SETTLED_INTERVAL_MS = 60_000;
const STATS_INTERVAL_MS = 30_000;
const ERA_INTERVAL_MS = 30_000;
const SLASHES_INTERVAL_MS = 30_000;
const STATUS_INTERVAL_MS = 6_000;
const MESSAGES_INTERVAL_MS = 30_000;

const AGENT_PAGES = 3; // 3 × 200: the indexer's live scan stops at 512 anyway
const ESCROW_PAGES = 3;
const SETTLED_PAGES = 2; // the most recent 400 settled agreements at most

/** Labels beside the points need this much viewport and no more than this many points. */
export const LABEL_MIN_VIEWPORT_REM = 64;
export const LABEL_MAX_NODES = 120;
/** Above this many points, the ones with no line are faded back. */
export const FADE_ISOLATED_ABOVE = 300;
export const ISOLATED_ALPHA = 0.35;

const HIT_RADIUS = 14; // px around a point that counts as pointing at it
const KEY_ROW = 18; // px per row of the key strip along the plate's foot
const KEY_PAD = 8;
/** Beyond this many lines of one state between the same two agents, the rest is a count. */
export const BUNDLE_CAP = 6;
const STATE_ORDER = { disputed: 0, open: 1, settled: 2 };
const SETTLE_TICKS = 300; // synchronous layout under reduced motion
const REHEAT_ALPHA = 0.3;
const LINK_DISTANCE = 70;
const CHARGE = -90;
const BOUNDS_PULL = 0.04;
const DRAW_IN_MS = 400;
const PULSE_MS = 600;
const FADE_MS = 400;

// ── pure model ───────────────────────────────────────────────────────────────

/** An agreement's identity on chain: buyer, provider and their running number. */
export const edgeKey = (buyer, provider, seq) => `${buyer}/${provider}/${seq}`;

/** Both directions between two accounts share one bundle of lines. */
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Created and Delivered are both "open — payment held"; Disputed is its own state. */
export const stateOf = (status) => (status === 'Disputed' ? 'disputed' : 'open');

/**
 * The lines to draw: every open agreement, then every settled one that is
 * not still open under the same key (deduplicated — the index can carry one
 * DeliveryConfirmed per agreement, but never trust that). Insertion order is
 * kept so the drawing order is stable.
 */
export function buildEdges(open, settled) {
  const edges = new Map();
  for (const a of open) {
    const key = edgeKey(a.buyer, a.provider, a.seq);
    edges.set(key, {
      key,
      buyer: a.buyer,
      provider: a.provider,
      seq: a.seq,
      state: stateOf(a.status),
      amountPlancks: a.amountPlancks,
      block: a.createdAtBlock,
    });
  }
  let settledShown = 0;
  for (const s of settled) {
    const key = edgeKey(s.buyer, s.provider, s.seq);
    if (edges.has(key)) continue;
    edges.set(key, {
      key,
      buyer: s.buyer,
      provider: s.provider,
      seq: s.seq,
      state: 'settled',
      amountPlancks: s.amountPlancks,
      block: s.blockNumber,
    });
    settledShown += 1;
  }
  return { edges, settledShown };
}

/**
 * What changed between two edge maps: lines to draw in, lines to fade out,
 * and lines whose status just became a dispute.
 */
export function diffEdges(previous, next) {
  const added = [];
  const removed = [];
  const disputed = [];
  for (const [key, edge] of next) {
    const before = previous.get(key);
    if (!before) added.push(edge);
    else if (before.state !== 'disputed' && edge.state === 'disputed') disputed.push(edge);
  }
  for (const [key, edge] of previous) {
    if (!next.has(key)) removed.push(edge);
  }
  return { added, removed, disputed };
}

/**
 * The points: one per registered agent, plus a hollow one for any party to a
 * line that the agent list does not contain. When the list is known to be
 * whole, such a party has left; when the list was cut short, it may simply
 * be beyond the cut, and the point says that instead.
 */
export function synthesizeNodes(agents, edges, { listComplete = true } = {}) {
  const nodes = new Map();
  for (const agent of agents) {
    nodes.set(agent.address, { id: agent.address, ...agent, ghost: false, degree: 0 });
  }
  const absent = listComplete ? 'no longer registered' : 'not among the agents listed — the list was cut short';
  for (const edge of edges.values()) {
    for (const address of [edge.buyer, edge.provider]) {
      if (!nodes.has(address)) nodes.set(address, { id: address, address, ghost: true, reason: absent, degree: 0 });
    }
  }
  for (const edge of edges.values()) {
    nodes.get(edge.buyer).degree += 1;
    nodes.get(edge.provider).degree += 1;
  }
  return nodes;
}

/**
 * Point radius by the square root of stake: area is proportional to stake,
 * which is how the eye reads "twice as much". Range 3–11 px, times the
 * crowding factor.
 */
export function nodeRadius(stakeCmn, maxStakeCmn, factor = 1) {
  const share = maxStakeCmn > 0 ? Math.sqrt(Math.max(0, stakeCmn) / maxStakeCmn) : 1;
  return (3 + 8 * Math.min(1, share)) * factor;
}

/** Smaller than any registered agent's point (which starts at 3 px). */
export const GHOST_RADIUS = 2.5;

/** Whether labels fit, how much to shrink the points, and how far to fade lone ones. */
export function labelPolicy(viewportPx, nodeCount, remPx = 16) {
  const labels = viewportPx >= LABEL_MIN_VIEWPORT_REM * remPx && nodeCount <= LABEL_MAX_NODES;
  const radiusFactor = nodeCount <= LABEL_MAX_NODES ? 1 : nodeCount <= FADE_ISOLATED_ABOVE ? 0.7 : 0.5;
  const isolatedAlpha = nodeCount > FADE_ISOLATED_ABOVE ? ISOLATED_ALPHA : 1;
  return { labels, radiusFactor, isolatedAlpha };
}

/**
 * Several agreements between the same two agents are drawn as a bundle of
 * arcs; this is the sideways offset of the i-th of n, symmetric about the
 * straight line, in px.
 */
export const BUNDLE_SPACING = 7; // px between lines of a small bundle
export const BUNDLE_MAX_BAND = 36; // px the whole bundle may span before lines close up
export const BUNDLE_MIN_SPACING = 2; // px; closer than this they read as one band anyway
export function parallelOffset(index, count) {
  if (count <= 1) return 0;
  const spacing = Math.max(BUNDLE_MIN_SPACING, Math.min(BUNDLE_SPACING, BUNDLE_MAX_BAND / (count - 1)));
  return (index - (count - 1) / 2) * spacing;
}

/**
 * The lines between one pair of agents: which are drawn, in what order, and
 * what the count labels say for the ones beyond the cap. Disputed lines come
 * first so they are never the ones hidden; within a state, the oldest first.
 */
export function bundleLayout(lines, cap = BUNDLE_CAP) {
  const byState = new Map();
  for (const line of lines) {
    if (!byState.has(line.state)) byState.set(line.state, []);
    byState.get(line.state).push(line);
  }
  const drawn = [];
  const hidden = [];
  const labels = [];
  for (const state of Object.keys(STATE_ORDER)) {
    const group = (byState.get(state) ?? []).sort((a, b) => a.block - b.block);
    drawn.push(...group.slice(0, cap));
    const rest = group.slice(cap);
    hidden.push(...rest);
    if (rest.length) labels.push({ state, count: group.length, text: `×${group.length} ${state}` });
  }
  return { drawn, hidden, labels };
}

/** Force tuning for the plate's size: a phone's plate needs shorter, gentler forces. */
export function forceScale(width, height) {
  return Math.max(0.4, Math.min(1, Math.min(width, height) / 560));
}

/** The one-sentence summary the canvas carries for screen readers. */
export function summaryText({ agents, open, disputed, settled }) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return `${n(agents, 'agent', 'agents')}, ${n(open, 'open agreement', 'open agreements')}, ${disputed} disputed, ${settled} recently settled`;
}

/** A deterministic angle from an address, so a new point lands in a stable place. */
export function seedAngle(address) {
  let h = 0;
  for (let i = 0; i < address.length; i += 1) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return (h % 3600) / 3600 * Math.PI * 2;
}

// ── the instrument ───────────────────────────────────────────────────────────

export function init(root, ctx) {
  const host = root.querySelector('.constellation-host');
  const canvas = root.querySelector('.constellation-canvas');
  const tip = root.querySelector('.constellation-tip');
  const list = root.querySelector('.agent-list');
  const note = root.querySelector('.constellation-note');
  const targets = {
    agents: ctx.reading('agents', root),
    active: ctx.reading('activeAgreements', root),
    disputes: ctx.reading('openDisputes', root),
    slashes: ctx.reading('slashes', root),
    messages: ctx.reading('messages', root),
  };
  const { formatCmn, cmnNumber, formatInteger, shortAddress } = ctx.format;
  const colour = (name) => ctx.theme.color(name);

  // ── source state ──
  let agentsList = null; // plain agent rows, or null while unread / unreadable
  let agentsComplete = true;
  let agentsTruncated = false;
  let openList = null;
  let settledList = null;
  let settledComplete = true;
  const failures = { agents: null, open: null, settled: null };
  const seen = { agents: false, open: false, settled: false };

  // ── graph state ──
  const nodes = new Map(); // address -> point (persistent objects: d3 mutates x/y)
  const edges = new Map(); // key -> line (persistent objects)
  let fading = []; // lines on their way out
  let settledShown = 0;
  let maxStakePlancks = 0n;
  let maxStakeCmn = 0;
  let ghostCount = 0;
  let laidOut = false;
  let hovered = null;
  let lastPointerType = 'mouse';
  let tapped = null;
  let bundleLabels = []; // { a, b, offset, text } for capped bundles

  const box = ctx.fitCanvas(canvas, onResize);

  const simulation = forceSimulation([])
    .force('link', forceLink([]).distance(LINK_DISTANCE))
    .force('charge', forceManyBody().strength(CHARGE))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide((d) => d.r + 4))
    .force('x', forceX(0).strength(BOUNDS_PULL))
    .force('y', forceY(0).strength(BOUNDS_PULL))
    .stop();
  simulation.on('tick', () => {
    clampToPlate();
    draw();
  });
  aimForces();

  /** The plate less the key strip along its foot. */
  function plate() {
    const { width, height } = box();
    const rows = 1 + (ghostCount > 0 ? 1 : 0);
    return { width, height: Math.max(1, height - rows * KEY_ROW - KEY_PAD) };
  }

  function aimForces() {
    const { width, height } = plate();
    const s = forceScale(width, height);
    simulation.force('center').x(width / 2).y(height / 2);
    simulation.force('x').x(width / 2).strength(BOUNDS_PULL / s);
    simulation.force('y').y(height / 2).strength(BOUNDS_PULL / s);
    simulation.force('link').distance(LINK_DISTANCE * s);
    simulation.force('charge').strength(CHARGE * s);
    simulation.force('collide').radius((d) => d.r + 4 * s);
  }

  function clampToPlate() {
    const { width, height } = plate();
    for (const node of nodes.values()) {
      const m = node.r + 6;
      node.x = Math.max(m, Math.min(width - m, node.x));
      node.y = Math.max(m, Math.min(height - m, node.y));
    }
  }

  function onResize(next) {
    // A resize is not a data change: positions scale with the plate, nothing reheats.
    const prev = lastBox;
    lastBox = next;
    if (prev && prev.width > 0 && prev.height > 0) {
      for (const node of nodes.values()) {
        node.x = (node.x / prev.width) * next.width;
        node.y = (node.y / prev.height) * next.height;
      }
    }
    aimForces();
    if (laidOut) computeRadii();
    draw();
  }
  let lastBox = box();

  // ── model ──
  function viewportWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 0;
  }

  function remPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  function policy() {
    return labelPolicy(viewportWidth(), nodes.size, remPx());
  }

  function computeRadii() {
    const { radiusFactor } = policy();
    for (const node of nodes.values()) {
      node.r = node.ghost ? GHOST_RADIUS * radiusFactor : nodeRadius(node.stakeCmn, maxStakeCmn, radiusFactor);
    }
  }

  function placeNew(node) {
    const { width, height } = plate();
    const neighbour = [...edges.values()]
      .map((e) => (e.buyer === node.id ? nodes.get(e.provider) : e.provider === node.id ? nodes.get(e.buyer) : null))
      .find((n) => n && Number.isFinite(n.x));
    const angle = seedAngle(node.id);
    if (neighbour) {
      node.x = neighbour.x + Math.cos(angle) * 24;
      node.y = neighbour.y + Math.sin(angle) * 24;
    } else {
      const spread = Math.min(width, height) * 0.3;
      node.x = width / 2 + Math.cos(angle) * spread * (0.3 + 0.7 * ((node.id.length * 7 + node.id.charCodeAt(0)) % 10) / 10);
      node.y = height / 2 + Math.sin(angle) * spread * (0.3 + 0.7 * ((node.id.length * 3 + node.id.charCodeAt(1)) % 10) / 10);
    }
  }

  function rebuild() {
    const agents = failures.agents ? [] : agentsList ?? [];
    const open = failures.open ? [] : openList ?? [];
    const settled = failures.settled ? [] : settledList ?? [];
    const built = failures.agents ? { edges: new Map(), settledShown: 0 } : buildEdges(open, settled);
    settledShown = built.settledShown;
    const nextNodes = synthesizeNodes(agents, built.edges, { listComplete: agentsComplete && !agentsTruncated });

    // Points: keep the objects d3 already positions; add and drop the rest.
    let nodesAdded = 0;
    let nodesRemoved = 0;
    for (const [id, data] of nextNodes) {
      const existing = nodes.get(id);
      if (existing) Object.assign(existing, data);
      else {
        nodes.set(id, { ...data, x: NaN, y: NaN, vx: 0, vy: 0, r: 3 });
        nodesAdded += 1;
      }
    }
    for (const id of [...nodes.keys()]) {
      if (!nextNodes.has(id)) {
        nodes.delete(id);
        nodesRemoved += 1;
      }
    }
    maxStakePlancks = 0n;
    ghostCount = 0;
    for (const node of nodes.values()) {
      if (node.ghost) {
        ghostCount += 1;
        continue;
      }
      const stake = BigInt(node.stakePlancks);
      if (stake > maxStakePlancks) maxStakePlancks = stake;
      node.stakeCmn = cmnNumber(node.stakePlancks);
    }
    maxStakeCmn = maxStakePlancks > 0n ? cmnNumber(maxStakePlancks.toString()) : 0;
    computeRadii();
    aimForces(); // the key strip's height and the collide radii follow the data
    for (const node of nodes.values()) if (!Number.isFinite(node.x)) placeNew(node);

    // Lines: diff, keep persisting objects, animate the changes.
    const diff = diffEdges(edges, built.edges);
    for (const [key, data] of built.edges) {
      const existing = edges.get(key);
      if (existing) Object.assign(existing, data, { source: nodes.get(data.buyer), target: nodes.get(data.provider) });
      else {
        const fresh = seen[data.state === 'settled' ? 'settled' : 'open'];
        edges.set(key, {
          ...data,
          source: nodes.get(data.buyer),
          target: nodes.get(data.provider),
          progress: fresh ? 0 : 1,
          alpha: 1,
          pulse: 0,
        });
      }
    }
    const leaving = [];
    for (const key of [...edges.keys()]) {
      if (!built.edges.has(key)) {
        leaving.push(edges.get(key));
        edges.delete(key);
      }
    }
    seen.open = seen.open || openList !== null;
    seen.settled = seen.settled || settledList !== null;
    assignBundles();

    simulation.nodes([...nodes.values()]);
    simulation.force('link').links([...edges.values()]);

    const nodesChanged = nodesAdded > 0 || nodesRemoved > 0;
    if (!laidOut && nodes.size > 0) {
      laidOut = true;
      settle(1);
    } else if (nodesChanged) {
      settle(REHEAT_ALPHA);
    }

    const arriving = [...edges.values()].filter((e) => e.progress === 0);
    if (arriving.length) {
      ctx.motion.tween(DRAW_IN_MS, (t) => {
        for (const e of arriving) e.progress = t;
        draw();
      });
    }
    const pulsing = diff.disputed.map((d) => edges.get(d.key)).filter(Boolean);
    if (pulsing.length) {
      ctx.motion.tween(PULSE_MS, (t) => {
        for (const e of pulsing) e.pulse = 1 - t;
        draw();
      });
    }
    if (leaving.length) {
      fading = fading.concat(leaving);
      ctx.motion.tween(FADE_MS, (t) => {
        for (const e of leaving) e.alpha = 1 - t;
        draw();
      }, { done: () => { fading = fading.filter((e) => !leaving.includes(e)); draw(); } });
    }
    if (!arriving.length && !pulsing.length && !leaving.length) draw();

    describe();
    renderList();
    renderNote();
  }

  /** Orders the lines of each pair so parallel agreements fan out as arcs. */
  function assignBundles() {
    const groups = new Map();
    for (const edge of edges.values()) {
      const k = pairKey(edge.buyer, edge.provider);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(edge);
    }
    bundleLabels = [];
    for (const group of groups.values()) {
      const { drawn, hidden, labels } = bundleLayout(group);
      const sign = (edge) => (edge.buyer < edge.provider ? 1 : -1); // arcs bend the same way whichever account buys
      drawn.forEach((edge, i) => {
        edge.hidden = false;
        edge.offset = parallelOffset(i, drawn.length) * sign(edge);
      });
      for (const edge of hidden) {
        edge.hidden = true;
        edge.offset = 0;
      }
      if (labels.length) {
        const first = drawn[0];
        const outer = parallelOffset(drawn.length - 1, drawn.length) * sign(first);
        bundleLabels.push({
          a: nodes.get(first.buyer < first.provider ? first.buyer : first.provider),
          b: nodes.get(first.buyer < first.provider ? first.provider : first.buyer),
          offset: outer,
          text: labels.map((l) => l.text).join(' · '),
          short: labels.map((l) => `×${l.count}`).join(' '),
        });
      }
    }
  }

  /** Runs the layout: its own bounded timer, or synchronously under reduced motion. */
  function settle(alpha) {
    simulation.alpha(alpha);
    if (ctx.motion.reduced() || document.hidden) {
      simulation.stop();
      simulation.tick(alpha >= 1 ? SETTLE_TICKS : Math.round(SETTLE_TICKS / 3));
      clampToPlate();
      draw();
      return;
    }
    simulation.restart();
  }

  ctx.bus.on('visibility', ({ hidden }) => {
    if (hidden) simulation.stop();
    else if (simulation.alpha() > simulation.alphaMin()) simulation.restart();
  });
  ctx.bus.on('theme', () => draw());

  // ── drawing ──
  function edgeColour(edge) {
    return colour(edge.state === 'disputed' ? 'disputed' : edge.state === 'settled' ? 'settled' : 'active');
  }

  function edgePath(g, edge, progress) {
    const { source: a, target: b, offset = 0 } = edge;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // A quadratic curve passes at half its control offset, so double it.
    const cx = (a.x + b.x) / 2 + nx * offset * 2;
    const cy = (a.y + b.y) / 2 + ny * offset * 2;
    g.beginPath();
    g.moveTo(a.x, a.y);
    if (progress >= 1) {
      g.quadraticCurveTo(cx, cy, b.x, b.y);
      return;
    }
    // De Casteljau: the sub-curve from the buyer up to `progress`.
    const t = progress;
    const c1x = a.x + (cx - a.x) * t;
    const c1y = a.y + (cy - a.y) * t;
    const m2x = cx + (b.x - cx) * t;
    const m2y = cy + (b.y - cy) * t;
    const px = c1x + (m2x - c1x) * t;
    const py = c1y + (m2y - c1y) * t;
    g.quadraticCurveTo(c1x, c1y, px, py);
  }

  function drawEdge(g, edge, isolatedAlpha) {
    if (!edge.source || !edge.target || edge.hidden) return;
    const state = edge.state;
    g.strokeStyle = edgeColour(edge);
    let alpha = edge.alpha;
    let width = 1;
    if (state === 'settled') {
      g.setLineDash([3, 4]);
      alpha *= 0.55;
    } else if (state === 'disputed') {
      g.setLineDash([]);
      width = 2 + 3 * edge.pulse;
      alpha *= 0.85 + 0.15 * edge.pulse;
    } else {
      g.setLineDash([]);
      alpha *= 0.75;
    }
    if (isolatedAlpha < 1 && (edge.source.degree <= 1 || edge.target.degree <= 1)) alpha *= 0.7;
    g.globalAlpha = Math.max(0, alpha);
    g.lineWidth = width;
    edgePath(g, edge, edge.progress);
    g.stroke();
    if (state === 'disputed' && edge.pulse > 0) {
      g.globalAlpha = 0.35 * edge.pulse;
      g.lineWidth = width + 6 * edge.pulse;
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  function drawReticle(g, width, height) {
    const cx = Math.round(width / 2) + 0.5;
    const cy = Math.round(height / 2) + 0.5;
    const radius = Math.min(width, height) * 0.46;
    g.strokeStyle = colour('border');
    g.lineWidth = 1;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.stroke();
    // Cardinal ticks on the ring and a small cross at its centre.
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.beginPath();
      g.moveTo(cx + ux * (radius - 5), cy + uy * (radius - 5));
      g.lineTo(cx + ux * (radius + 5), cy + uy * (radius + 5));
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - 5, cy);
    g.lineTo(cx + 5, cy);
    g.moveTo(cx, cy - 5);
    g.lineTo(cx, cy + 5);
    g.stroke();
    g.globalAlpha = 1;
  }

  function drawKey(g, width, height) {
    const font = ctx.theme.font('mono');
    g.font = `400 10px ${font}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = colour('text-dim');
    let y = height - KEY_ROW / 2;
    if (ghostCount > 0) {
      g.strokeStyle = colour('text-dim');
      g.lineWidth = 1;
      g.beginPath();
      g.arc(10.5, y, GHOST_RADIUS, 0, Math.PI * 2);
      g.stroke();
      g.fillText(agentsComplete && !agentsTruncated ? 'no longer registered' : 'not among the agents listed', 20, y);
      y -= KEY_ROW;
    }
    if (maxStakePlancks > 0n) {
      const r = nodeRadius(maxStakeCmn, maxStakeCmn, policy().radiusFactor);
      g.fillStyle = colour('text');
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(10.5, y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = colour('text-dim');
      g.fillText(`${formatCmn(maxStakePlancks.toString())} CMN staked`, Math.max(20, 12 + r + 6), y);
    }
  }

  /** Text knocked out of the lines beneath it: a plate-coloured stroke, then the fill. */
  function knockout(g, text, x, y) {
    g.strokeStyle = colour('bg');
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillText(text, x, y);
  }

  function drawEmpty(g, width, height, lines) {
    const font = ctx.theme.font('mono');
    g.font = `400 11px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = colour('text-dim');
    lines.forEach((line, i) => g.fillText(line, width / 2, height / 2 + (i - (lines.length - 1) / 2) * 16));
  }

  function draw() {
    const { context: g, width, height } = box();
    const area = plate();
    g.clearRect(0, 0, width, height);
    drawReticle(g, area.width, area.height);

    if (failures.agents) {
      drawEmpty(g, width, height, ['agents unavailable', failures.agents]);
      return;
    }
    if (!laidOut) {
      drawEmpty(g, width, height, [agentsList === null ? 'reading the agent list…' : 'no agents registered']);
      if (agentsList !== null) drawKey(g, width, height);
      return;
    }

    const { labels, isolatedAlpha } = policy();
    const font = ctx.theme.font('mono');

    // Lines, back to front: gone, settled, open, disputed.
    for (const edge of fading) drawEdge(g, edge, isolatedAlpha);
    for (const state of ['settled', 'open', 'disputed']) {
      for (const edge of edges.values()) if (edge.state === state) drawEdge(g, edge, isolatedAlpha);
    }

    // Points.
    for (const node of nodes.values()) {
      const lone = node.degree === 0;
      g.globalAlpha = lone ? isolatedAlpha : 1;
      g.beginPath();
      g.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      if (node.ghost) {
        g.strokeStyle = colour('text-dim');
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = colour('text');
        if (node.leaving) g.globalAlpha *= 0.5;
        g.fill();
        g.strokeStyle = colour('bg');
        g.lineWidth = 1;
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Bundle counts, where more lines join two agents than are drawn.
    g.font = `400 10px ${font}`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = colour('text-dim');
    for (const { a, b, offset, text, short } of bundleLabels) {
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const away = offset + Math.sign(offset || 1) * 8;
      knockout(g, labels ? text : short, (a.x + b.x) / 2 - (dy / len) * away, (a.y + b.y) / 2 + (dx / len) * away);
    }

    // Labels: the busiest and largest first; one that would sit on another is left off
    // (the point is still reachable by pointer and in the list).
    if (labels) {
      g.textAlign = 'left';
      const placed = [];
      const ordered = [...nodes.values()].filter((n) => !n.ghost).sort((a, b) => b.degree - a.degree || b.r - a.r);
      for (const node of ordered) {
        const text = node.name || shortAddress(node.id);
        const w = g.measureText(text).width;
        const rect = { x: node.x + node.r + 4, y: node.y - 6, w, h: 12 };
        if (rect.x + w > area.width) continue;
        if (placed.some((p) => rect.x < p.x + p.w && p.x < rect.x + rect.w && rect.y < p.y + p.h && p.y < rect.y + rect.h)) continue;
        placed.push(rect);
        knockout(g, text, rect.x, node.y);
      }
    }

    // The pointed-at agent.
    if (hovered && nodes.has(hovered.id)) {
      g.strokeStyle = colour('live');
      g.lineWidth = 1;
      g.beginPath();
      g.arc(hovered.x, hovered.y, hovered.r + 4, 0, Math.PI * 2);
      g.stroke();
      positionTip();
    }

    drawKey(g, width, height);
  }

  // ── accessibility, list, note ──
  function counts() {
    let open = 0;
    let disputed = 0;
    let settled = 0;
    for (const edge of edges.values()) {
      if (edge.state === 'settled') settled += 1;
      else {
        open += 1;
        if (edge.state === 'disputed') disputed += 1;
      }
    }
    return { agents: agentsList?.length ?? 0, open, disputed, settled };
  }

  function describe() {
    canvas.setAttribute('aria-label', failures.agents ? `Agents unavailable: ${failures.agents}` : summaryText(counts()));
  }

  function explorerLink(address) {
    const a = document.createElement('a');
    a.href = `${ctx.EXPLORER_ORIGIN}/account/${address}`;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function renderList() {
    if (!list) return;
    list.replaceChildren();
    if (failures.agents || agentsList === null) {
      const li = document.createElement('li');
      li.className = 'dim';
      li.textContent = failures.agents ? `unavailable — ${failures.agents}` : 'reading the agent list…';
      list.append(li);
      return;
    }
    for (const agent of agentsList) {
      const li = document.createElement('li');
      const a = explorerLink(agent.address);
      a.textContent = agent.name ? `${agent.name} · ${shortAddress(agent.address)}` : shortAddress(agent.address);
      li.append(
        a,
        ` · ${formatCmn(agent.stakePlancks)} CMN · ${formatInteger(agent.activeEscrowCount)} open · ${formatInteger(agent.completedAgreements)} completed${agent.leaving ? ' · leaving' : ''}`,
      );
      list.append(li);
    }
    if (ghostCount > 0) {
      const li = document.createElement('li');
      li.className = 'dim';
      li.textContent = `${ghostCount} ${ghostCount === 1 ? 'party' : 'parties'} to a drawn line ${agentsComplete && !agentsTruncated ? 'no longer registered' : 'not among the agents listed'}`;
      list.append(li);
    }
  }

  function renderNote() {
    if (!note) return;
    const parts = [];
    if (failures.settled) parts.push(`Settled lines could not be read: ${failures.settled}.`);
    else if (settledList !== null) {
      parts.push(
        `Settled lines are the most recent DeliveryConfirmed events in the finalized-block index (${formatInteger(settledShown)} shown); older history is not drawn.`,
      );
    } else parts.push('Reading settled agreements from the finalized-block index…');
    if (bundleLabels.length) {
      parts.push(`Where more than ${BUNDLE_CAP} lines of one kind join the same two agents, ${BUNDLE_CAP} are drawn and the count is written beside them.`);
    }
    if (failures.open) parts.push(`Open agreements could not be read: ${failures.open}.`);
    if (agentsTruncated || !agentsComplete) parts.push('The agent list was cut short at the indexer’s scan cap; agents beyond it are not drawn.');
    if (!settledComplete && !failures.settled) parts.push(`Only the newest ${SETTLED_PAGES * 200} settled agreements were read.`);
    note.textContent = parts.join(' ');
  }

  // ── pointer ──
  function pointerToPlate(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function tipText(node) {
    const lines = [];
    if (node.ghost) {
      lines.push([shortAddress(node.id), true], [node.reason, false], [`${node.degree} ${node.degree === 1 ? 'line' : 'lines'} drawn`, false]);
    } else {
      lines.push([node.name ? `${node.name} · ${shortAddress(node.id)}` : shortAddress(node.id), true]);
      lines.push([`${formatCmn(node.stakePlancks)} CMN staked`, false]);
      lines.push([`${formatInteger(node.activeEscrowCount)} open · ${formatInteger(node.completedAgreements)} completed`, false]);
      if (node.leaving) lines.push(['leaving — unstake requested', false]);
      lines.push([lastPointerType === 'touch' ? 'tap again to open in the explorer' : 'click to open in the explorer', false]);
    }
    return lines;
  }

  function showTip(node) {
    if (!tip) return;
    tip.replaceChildren();
    for (const [text, strong] of tipText(node)) {
      const span = document.createElement(strong ? 'strong' : 'span');
      span.textContent = text;
      tip.append(span);
    }
    tip.hidden = false;
    positionTip();
  }

  function positionTip() {
    if (!tip || tip.hidden || !hovered) return;
    const { width, height } = plate();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = hovered.x + hovered.r + 10;
    let top = hovered.y - th / 2;
    if (left + tw > width - 4) left = hovered.x - hovered.r - 10 - tw;
    if (left < 4) left = 4;
    top = Math.max(4, Math.min(height - th - 4, top));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hideTip() {
    if (tip) tip.hidden = true;
  }

  function setHovered(node) {
    if (node === hovered) return;
    hovered = node;
    canvas.style.cursor = node && !node.ghost ? 'pointer' : '';
    if (node) showTip(node);
    else {
      hideTip();
      tapped = null;
    }
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    lastPointerType = event.pointerType || 'mouse';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!laidOut) return;
    const { x, y } = pointerToPlate(event);
    setHovered(simulation.find(x, y, HIT_RADIUS) ?? null);
  });
  canvas.addEventListener('pointerleave', () => setHovered(null));
  canvas.addEventListener('click', (event) => {
    if (!laidOut) return;
    const { x, y } = pointerToPlate(event);
    const node = simulation.find(x, y, HIT_RADIUS) ?? null;
    if (lastPointerType === 'touch') {
      // First tap shows; a second tap on the same point opens.
      if (node !== tapped) {
        tapped = node;
        setHovered(node);
        if (node) showTip(node);
        return;
      }
    }
    if (node && !node.ghost) window.open(`${ctx.EXPLORER_ORIGIN}/account/${node.id}`, '_blank', 'noopener');
  });

  // ── data ──
  ctx.watchAll(
    'agents',
    (record) => {
      const ok = ctx.readout.apply(targets.agents, record, (data) => {
        agentsTruncated = ctx.field(data, 'truncated');
        const total = ctx.field(data, 'total');
        const rows = record.items.map((item) => ({
          address: ctx.field(item, 'address'),
          stakePlancks: ctx.field(item, 'stakePlancks'),
          completedAgreements: ctx.field(item, 'completedAgreements'),
          activeEscrowCount: ctx.field(item, 'activeEscrowCount'),
          // Both are documented as nullable: null is "none", not a missing field.
          name: item.metadata === null ? null : ctx.field(item, 'metadata.name'),
          leaving: item.unstakeAtBlock === null ? false : Number.isFinite(ctx.field(item, 'unstakeAtBlock')),
        }));
        agentsComplete = record.complete;
        agentsList = rows;
        failures.agents = null;
        const floor = agentsTruncated || !record.complete;
        ctx.readout.showValue(targets.agents, record, {
          value: total,
          prefix: floor ? '≥ ' : '',
          extra: agentsTruncated ? 'live scan cut short at the indexer’s cap' : `${formatInteger(rows.length)} listed`,
          motion: ctx.motion,
        });
      });
      if (!ok) {
        agentsList = null;
        failures.agents = record.ok ? 'a field was missing from the response' : record.error;
        laidOut = false;
      }
      rebuild();
    },
    AGENTS_INTERVAL_MS,
    { maxPages: AGENT_PAGES },
  );

  ctx.watchAll(
    'escrows',
    (record) => {
      if (!record.ok) {
        openList = null;
        failures.open = record.error;
        rebuild();
        return;
      }
      try {
        openList = record.items.map((item) => ({
          buyer: ctx.field(item, 'buyer'),
          provider: ctx.field(item, 'provider'),
          seq: ctx.field(item, 'seq'),
          status: ctx.field(item, 'status'),
          amountPlancks: ctx.field(item, 'amountPlancks'),
          createdAtBlock: ctx.field(item, 'createdAtBlock'),
        }));
        failures.open = null;
      } catch (error) {
        openList = null;
        failures.open = error.message;
      }
      rebuild();
    },
    ESCROWS_INTERVAL_MS,
    { maxPages: ESCROW_PAGES },
  );

  ctx.watchAll(
    'deliveriesConfirmed',
    (record) => {
      if (!record.ok) {
        settledList = null;
        failures.settled = record.error;
        rebuild();
        return;
      }
      try {
        settledList = record.items.map((item) => ({
          blockNumber: ctx.field(item, 'blockNumber'),
          buyer: ctx.field(item, 'data.buyer'),
          provider: ctx.field(item, 'data.provider'),
          seq: ctx.field(item, 'data.seq'),
          amountPlancks: ctx.field(item, 'data.amount'),
        }));
        settledComplete = record.complete;
        failures.settled = null;
      } catch (error) {
        settledList = null;
        failures.settled = error.message;
      }
      rebuild();
    },
    SETTLED_INTERVAL_MS,
    { maxPages: SETTLED_PAGES },
  );

  ctx.watch(
    'escrowStats',
    (record) => {
      ctx.readout.apply([targets.active, targets.disputes], record, (data) => {
        const truncated = ctx.field(data, 'scanTruncated');
        const prefix = truncated ? '≥ ' : '';
        const extra = truncated ? 'live scan cut short at the indexer’s cap' : 'live chain state';
        ctx.readout.showValue(targets.active, record, {
          value: ctx.field(data, 'activeAgreementCount'),
          prefix,
          extra,
          motion: ctx.motion,
        });
        ctx.readout.showValue(targets.disputes, record, {
          value: ctx.field(data, 'byStatus.Disputed'),
          prefix,
          extra,
          motion: ctx.motion,
        });
      });
    },
    STATS_INTERVAL_MS,
  );

  // Slashes this era: the era's first block from /v1/eras/current, then the
  // SlashExecuted events at or after it, newest first.
  let eraRecord = null;
  let slashesRecord = null;
  function showSlashes() {
    if (!eraRecord || !slashesRecord) return;
    if (!eraRecord.ok) {
      ctx.readout.showError(targets.slashes, eraRecord, 'needs the era’s first block, which could not be read');
      return;
    }
    let startBlock;
    try {
      startBlock = ctx.field(eraRecord.data, 'startBlock');
    } catch (error) {
      ctx.readout.showError(targets.slashes, eraRecord, error.message);
      return;
    }
    ctx.readout.apply(targets.slashes, slashesRecord, (data, record) => {
      const { count, reachedStart } = ctx.countSince(record.items, startBlock);
      ctx.readout.showValue(targets.slashes, record, {
        value: count,
        prefix: !record.complete && !reachedStart ? '≥ ' : '',
        extra: `since block #${formatInteger(startBlock)}`,
        motion: ctx.motion,
      });
    });
  }
  ctx.watch(
    'era',
    (record) => {
      eraRecord = record;
      showSlashes();
    },
    ERA_INTERVAL_MS,
  );
  ctx.watchAll(
    'slashes',
    (record) => {
      slashesRecord = record;
      showSlashes();
    },
    SLASHES_INTERVAL_MS,
  );

  // Messages: a figure that cannot exist until the messaging runtime is in force.
  let watchingMessages = false;
  const messagesSpec = Number(targets.messages?.dataset.messagesSpec);
  ctx.watch(
    'status',
    (record) => {
      if (watchingMessages) return;
      if (!record.ok) {
        ctx.readout.showError(targets.messages, record, 'needs the runtime version, which could not be read');
        return;
      }
      let spec;
      try {
        spec = ctx.field(record.data, 'chain.specVersion');
      } catch (error) {
        ctx.readout.showError(targets.messages, record, error.message);
        return;
      }
      if (Number.isFinite(messagesSpec) && spec < messagesSpec) {
        ctx.readout.showAbsent(
          targets.messages,
          record,
          `not on chain yet — messaging arrives with runtime ${messagesSpec}; the chain runs ${spec}`,
        );
        return;
      }
      watchingMessages = true;
      ctx.watch(
        'messages',
        (messages) => {
          ctx.readout.apply(targets.messages, messages, (data) => {
            ctx.readout.showValue(targets.messages, messages, { value: ctx.field(data, 'total'), motion: ctx.motion });
          });
        },
        MESSAGES_INTERVAL_MS,
      );
    },
    STATUS_INTERVAL_MS,
  );

  renderList();
  renderNote();
  draw();
}
