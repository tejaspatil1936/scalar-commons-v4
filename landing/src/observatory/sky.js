// Part B · the sky. `/observatory?sky=1` lays a WebGL star field behind the
// plates: one star per registered agent — the same `/v1/agents` read the
// constellation makes, on the same schedule, so the two can never disagree —
// placed by a hash of its address so a star stays where it was, sized and
// brightened by the agreements it has completed. The sky moves only when the
// chain does: each new head runs one tween (a faint pulse through the field
// and a small drift), then the field rests. There is no free-running loop
// (nothing on this page loops forever), no fetch of its own, and under
// prefers-reduced-motion the field is drawn once at rest and redrawn only
// when the data, the theme or the viewport changes. Off by default: without
// the flag nothing here runs and nothing is drawn.
//
// The footer carries the sky's own provenance line — how many stars, from
// which endpoint, read when — so a reader knows what the points are. A
// browser without WebGL gets that line saying so, and no sky.

export const SKY_BEAT_MS = 1400;
/** The most stars drawn; the indexer's live scan stops well before this. */
export const MAX_STARS = 4096;
/** How far the field drifts per block, as a fraction of the viewport width. */
export const DRIFT_PER_BLOCK = 0.0012;
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
 * A star from an agent: a position in [0, 1)² from the address hash (so it
 * is the same on every visit and every screen), a size of 4–12 px and a
 * brightness of 0.55–1 by the square root of its share of the busiest
 * agent's activity (area grows with activity, as the constellation's points
 * do), and a phase that keys its place in the pulse. Pure; tested.
 */
export function starOf(address, activity, maxActivity) {
  const h = hashAddress(String(address));
  const x = (h & 0xffff) / 0x10000;
  const y = ((h >>> 16) & 0xffff) / 0x10000;
  const phase = (hashAddress(`${address}:phase`) & 0xffff) / 0x10000;
  const share = maxActivity > 0 ? Math.min(1, Math.sqrt(Math.max(0, activity) / maxActivity)) : 0;
  return { x, y, phase, size: 4 + 8 * share, bright: 0.55 + 0.45 * share };
}

/** Packed vertex data, five floats per star: x, y, size, phase, brightness. Pure; tested. */
export function starsFor(agents, activityOf = (agent) => Number(agent.completedAgreements) || 0) {
  const rows = agents.slice(0, MAX_STARS);
  const maxActivity = rows.reduce((max, agent) => Math.max(max, activityOf(agent)), 0);
  const data = new Float32Array(rows.length * 5);
  rows.forEach((agent, i) => {
    const s = starOf(agent.address, activityOf(agent), maxActivity);
    data.set([s.x, s.y, s.size, s.phase, s.bright], i * 5);
  });
  return { data, count: rows.length, maxActivity };
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

const VERTEX = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_phase;
attribute float a_bright;
uniform float u_dpr;
uniform float u_time;
uniform float u_beat;
uniform float u_drift;
uniform float u_light;
varying float v_alpha;
void main() {
  float x = fract(a_pos.x + u_drift);
  vec2 clip = vec2(x, a_pos.y) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  // The pulse: while a beat runs, each star brightens by its phase, then rests.
  float twinkle = 0.5 + 0.5 * sin(6.2832 * (a_phase + u_time));
  float wave = u_beat * twinkle;
  gl_PointSize = a_size * u_dpr * (1.0 + 0.6 * wave);
  v_alpha = a_bright * (0.75 + 0.25 * wave) * mix(1.0, 0.75, u_light);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_color;
varying float v_alpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = (smoothstep(1.0, 0.0, r) * 0.45 + smoothstep(0.35, 0.0, r) * 0.55) * v_alpha;
  gl_FragColor = vec4(u_color * a, a);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader failed to compile');
  return shader;
}

/** Wires the sky when the document carries the flag. Returns the controller, or null when off or unavailable. */
export function init(doc, ctx, { search = doc.defaultView?.location?.search } = {}) {
  if (!wantsSky(search)) return null;
  const html = doc.documentElement;
  const win = doc.defaultView;
  const note = doc.querySelector('[data-reading="sky"]');
  if (note) note.hidden = false;
  html.setAttribute('data-sky', '');

  const canvas = doc.createElement('canvas');
  canvas.className = 'sky';
  canvas.setAttribute('aria-hidden', 'true');
  doc.body.prepend(canvas);
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true }) ||
    canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) {
    canvas.remove();
    html.removeAttribute('data-sky');
    if (note) {
      note.querySelector('.reading-value').textContent = 'no sky: this browser has no WebGL';
      note.querySelector('.reading-value').classList.remove('is-loading');
    }
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program failed to link');
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = 5 * 4;
  for (const [name, size, offset] of [['a_pos', 2, 0], ['a_size', 1, 8], ['a_phase', 1, 12], ['a_bright', 1, 16]]) {
    const at = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
  }
  const uniforms = Object.fromEntries(['u_dpr', 'u_time', 'u_beat', 'u_drift', 'u_light', 'u_color'].map((n) => [n, gl.getUniformLocation(program, n)]));
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let count = 0;
  let time = 0;
  let beat = 0;
  let drift = 0;
  let dpr = 1;
  let lastHead = null;
  let cancelBeat = () => {};
  let lastFrameAt = null;
  const durations = [];

  function fit() {
    // Stars are soft discs, never text: one device pixel per CSS pixel is enough and keeps the
    // fill cost of a full-viewport layer low (a 5 MP clear on a software renderer was the bottleneck).
    dpr = 1;
    const width = Math.max(1, Math.round(win.innerWidth || html.clientWidth));
    const height = Math.max(1, Math.round(win.innerHeight || html.clientHeight));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function colour() {
    return parseColor(ctx.theme.color('text')) ?? [0.85, 0.87, 0.9];
  }

  function draw() {
    const now = win.performance.now();
    if (lastFrameAt !== null && beat > 0) {
      durations.push(now - lastFrameAt);
      if (durations.length > STATS_WINDOW) durations.shift();
    }
    lastFrameAt = now;
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;
    gl.uniform1f(uniforms.u_dpr, dpr);
    gl.uniform1f(uniforms.u_time, time);
    gl.uniform1f(uniforms.u_beat, beat);
    gl.uniform1f(uniforms.u_drift, drift);
    gl.uniform1f(uniforms.u_light, ctx.theme.isDark() ? 0 : 1);
    gl.uniform3fv(uniforms.u_color, colour());
    gl.drawArrays(gl.POINTS, 0, count);
  }

  function report() {
    const stats = frameStats(durations);
    canvas.dataset.frames = String(stats.frames);
    canvas.dataset.fps = stats.fps === null ? '' : String(stats.fps);
    canvas.dataset.worstMs = stats.worstMs === null ? '' : String(stats.worstMs);
    canvas.dataset.stars = String(count);
  }

  /** One beat per block: the pulse rises and settles, the field drifts by one step, then rests. */
  function onBlock() {
    cancelBeat();
    const timeFrom = time;
    const driftFrom = drift;
    lastFrameAt = null;
    cancelBeat = ctx.motion.tween(SKY_BEAT_MS, (t) => {
      beat = ctx.motion.reduced() ? 0 : Math.sin(Math.PI * t); // up and down once
      time = timeFrom + 0.08 * t;
      drift = (driftFrom + DRIFT_PER_BLOCK * t) % 1;
      draw();
    }, { done: () => { beat = 0; draw(); report(); } });
  }

  ctx.watchAll('agents', (record) => {
    // The same read the constellation makes; a missing field is a shown failure, never a guessed star.
    const ok = ctx.readout.apply(note ? [note] : [], record, () => {
      const agents = record.items.map((item) => ({
        address: ctx.field(item, 'address'),
        completedAgreements: ctx.field(item, 'completedAgreements'),
      }));
      const stars = starsFor(agents);
      count = stars.count;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, stars.data, gl.STATIC_DRAW);
      if (note) {
        ctx.readout.showValue(note, record, {
          value: count,
          unit: count === 1 ? 'star' : 'stars',
          extra: `one per registered agent${record.complete ? '' : ' listed'}, larger and brighter the more agreements it has completed; the sky moves once per block`,
          motion: ctx.motion,
          live: false,
        });
      }
    });
    if (!ok) count = 0; // a failed read empties the sky: no stale stars
    draw();
    report();
  }, 60_000, { maxPages: 3 });

  ctx.bus.on('head', ({ number }) => {
    if (number === null || number === lastHead) return;
    lastHead = number;
    if (doc.hidden) return;
    onBlock();
  });
  ctx.bus.on('theme', () => draw());
  ctx.bus.on('visibility', ({ hidden }) => {
    if (hidden) {
      cancelBeat();
      beat = 0;
    } else draw();
  });
  win.addEventListener('resize', () => {
    fit();
    draw();
  });
  ctx.motion.onChange(() => {
    cancelBeat();
    beat = 0;
    draw();
  });

  fit();
  draw();
  return { stats: () => frameStats(durations), stars: () => count, canvas };
}
