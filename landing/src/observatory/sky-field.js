// The sky's scene: three.js points, line segments and a narrow strip per
// light front, each with its own small shader, timed by GSAP. The steady glow
// behind the finality marker and the marker's hairline are a CSS gradient on
// a layer under the canvas, placed by one custom property, so the one thing
// that covers the whole viewport costs the GPU nothing per frame; the canvas
// shades only the pixels that carry light. Fetched by `sky.js` only
// when `?sky=1` is on; nothing here is in the ordinary page's bundle. The
// model (places, sizes, lines, the marker, the frame judge) is handed in, so
// this module imports nothing of the page's and the chunk carries only the
// scene and its two libraries.
//
// Depth: stars sit at a distance drawn from their address, point size falls
// with distance (perspective sizing in the vertex shader), and in the dark
// theme the material is additive, so overlapping stars add their light. In
// the light theme additive light on paper would add nothing, so the same
// shaders draw with normal blending in the ink colour.
//
// Motion: the camera orbits the field's centre one degree a minute and
// shifts with the scroll position, so near stars slide against far ones.
// Each block starts one light front (a GSAP tween across the field) and
// moves the finality marker; a dispute flickers once by the time it was
// first seen; a settlement's glow fades by its age. The render loop is
// GSAP's ticker, removed while the tab is hidden, and it judges itself: under
// MIN_FPS for SLOW_SECONDS whole seconds, the scene disposes of itself and
// the page's canvas hero stands.
//
// No lens flares, no bloom pass, no textures: every glow is a few lines of
// fragment shader on a point sprite or a quad.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineSegments,
  Mesh,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { gsap } from 'gsap';

const FOV = 50; // degrees
const NEAR = 6; // the nearest star's distance from the camera's orbit, in world units
const RANGE = 10; // the far star is this much further
const OVERFILL = 1.12; // the field is laid a little past the frustum so the drift shows no edge
const FRONTS = 3; // light fronts in flight at once; a fourth replaces the oldest
const FRONT_HALF = 0.12; // a front's strip reaches this far either side of its line, in clip units
const PARALLAX = 0.35; // camera shift per viewport of scroll, in world units
const MARKER_MS = 600;
const AGENTS_INTERVAL_MS = 60_000;
const ESCROWS_INTERVAL_MS = 30_000;
const SETTLED_INTERVAL_MS = 60_000;
const VALIDATORS_INTERVAL_MS = 60_000;
const AGENT_PAGES = 3;
const ESCROW_PAGES = 3;
const SETTLED_PAGES = 2;
const MAX_LINES = 2048; // segments the line buffer holds; the indexer's scan stops well before this

const STAR_VERTEX = `
attribute float aSize;
attribute float aBright;
attribute float aKind;
uniform float uScale;
uniform float uFront[${FRONTS}];
varying float vAlpha;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  float x = clip.x / clip.w;
  // A light front passing over a star lifts it briefly.
  float bump = 0.0;
  for (int i = 0; i < ${FRONTS}; i++) {
    float f = uFront[i];
    if (f < 1.5) { float d = (x - f) / 0.12; bump += exp(-d * d); }
  }
  bump = min(bump, 1.0);
  gl_Position = clip;
  // A star is its size in pixels at the orbit distance, larger nearer and smaller further: depth by point size.
  gl_PointSize = aSize * (1.0 + 0.35 * bump) * uScale / max(0.001, -mv.z);
  vAlpha = aBright * (1.0 + 0.6 * bump);
  vKind = aKind;
}`;

const STAR_FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform vec3 uValidator;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = smoothstep(1.0, 0.0, r) * 0.35 + smoothstep(0.3, 0.0, r) * 0.65;
  float a = core * vAlpha;
  vec3 c = uColor;
  if (vKind > 0.5) {
    // The reticle: a faint thin ring and four hairline ticks around a bright core.
    float ring = smoothstep(0.05, 0.0, abs(r - 0.8)) * 0.22;
    float ticks = max(step(abs(d.x), 0.018), step(abs(d.y), 0.018)) * step(0.5, r) * 0.18;
    a = max(a, (ring + ticks) * vAlpha);
    c = uValidator;
  }
  gl_FragColor = vec4(c * a, a);
}`;

const LINE_VERTEX = `
attribute float aState;
attribute float aT0;
uniform float uTime;
uniform vec3 uOpen;
uniform vec3 uAmber;
uniform vec3 uSettled;
uniform float uFlicker;
uniform float uFade;
varying vec4 vColor;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float dt = uTime - aT0;
  vec3 c = uOpen;
  float a = 0.16;
  if (aState > 1.5) {
    // Settled: a steady low glow that fades over ten minutes.
    c = uSettled;
    a = 0.32 * clamp(1.0 - dt / uFade, 0.0, 1.0);
  } else if (aState > 0.5) {
    // Disputed: amber, flickering once from the moment it was first seen.
    float f = clamp(dt / uFlicker, 0.0, 1.0);
    float flick = (1.0 - f) * (0.5 + 0.5 * sin(dt * 55.0)) * step(dt, uFlicker);
    c = uAmber;
    a = 0.22 + 0.6 * flick;
  }
  vColor = vec4(c * a, a);
}`;

const LINE_FRAGMENT = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

const FRONT_VERTEX = `
attribute float aU;
varying float vU;
varying float vY;
void main() { vU = aU; vY = position.y; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRONT_FRAGMENT = `
precision mediump float;
uniform vec3 uGlow;
varying float vU;
varying float vY;
void main() {
  // A soft band, brighter mid-screen so it reads as light, not a stripe.
  float d = vU * 2.4;
  float a = exp(-d * d) * 0.11 * (1.0 - 0.5 * abs(vY));
  gl_FragColor = vec4(uGlow * a, a);
}`;

export function start({ doc, win, ctx, model, note, onFallback }) {
  const html = doc.documentElement;
  const canvas = doc.createElement('canvas');
  canvas.className = 'sky';
  canvas.setAttribute('aria-hidden', 'true');
  doc.body.prepend(canvas);

  // Under the canvas: the settled region behind the finality marker and the marker's hairline, as a gradient.
  const settledLayer = doc.createElement('div');
  settledLayer.className = 'sky-settled';
  settledLayer.setAttribute('aria-hidden', 'true');
  doc.body.prepend(settledLayer);

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  // Stars are soft discs, never text: one device pixel per CSS pixel keeps the fill cost of a full-viewport layer low.
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, NEAR + RANGE + 4);
  const centre = new Vector3(0, 0, -(NEAR + RANGE / 2));
  const orbit = NEAR + RANGE / 2;

  const frontSlots = Array.from({ length: FRONTS }, () => ({ x: 2 }));
  const markerState = { x: 1 }; // the finality marker, in clip units; tweened
  const uniforms = {
    uScale: { value: 1 },
    uFront: { value: frontSlots.map((s) => s.x) },
    uTime: { value: 0 },
    uColor: { value: [1, 1, 1] },
    uValidator: { value: [1, 1, 1] },
    uOpen: { value: [1, 1, 1] },
    uAmber: { value: [1, 1, 1] },
    uSettled: { value: [1, 1, 1] },
    uGlow: { value: [1, 1, 1] },
    uFlicker: { value: model.FLICKER_MS / 1000 },
    uFade: { value: model.SETTLE_FADE_MS / 1000 },
  };
  const pick = (names) => Object.fromEntries(names.map((n) => [n, uniforms[n]]));
  const common = { transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true };

  // Buffers are allocated once at capacity and refilled, so a rebuild never churns GPU memory.
  const dynamic = (array, itemSize) => {
    const attribute = new BufferAttribute(array, itemSize);
    attribute.setUsage(DynamicDrawUsage);
    return attribute;
  };
  const starBuffers = {
    position: new Float32Array(model.MAX_STARS * 3),
    size: new Float32Array(model.MAX_STARS),
    bright: new Float32Array(model.MAX_STARS),
    kind: new Float32Array(model.MAX_STARS),
  };
  const lineBuffers = { position: new Float32Array(MAX_LINES * 6), state: new Float32Array(MAX_LINES * 2), t0: new Float32Array(MAX_LINES * 2) };
  // One narrow strip per front, two triangles each, its corners moved along x every frame.
  const frontBuffers = { position: new Float32Array(FRONTS * 6 * 3), u: new Float32Array(FRONTS * 6) };
  for (let i = 0; i < FRONTS; i += 1) frontBuffers.u.set([-1, 1, -1, -1, 1, 1], i * 6);
  const frontGeometry = new BufferGeometry();
  frontGeometry.setAttribute('position', dynamic(frontBuffers.position, 3));
  frontGeometry.setAttribute('aU', dynamic(frontBuffers.u, 1));
  frontGeometry.setDrawRange(0, 0);
  const frontMaterial = new ShaderMaterial({ ...common, vertexShader: FRONT_VERTEX, fragmentShader: FRONT_FRAGMENT, uniforms: pick(['uGlow']) });
  const fronts = new Mesh(frontGeometry, frontMaterial);
  fronts.frustumCulled = false;
  fronts.renderOrder = 0;
  scene.add(fronts);

  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', dynamic(lineBuffers.position, 3));
  lineGeometry.setAttribute('aState', dynamic(lineBuffers.state, 1));
  lineGeometry.setAttribute('aT0', dynamic(lineBuffers.t0, 1));
  lineGeometry.setDrawRange(0, 0);
  const lineMaterial = new ShaderMaterial({ ...common, vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT, uniforms: pick(['uTime', 'uOpen', 'uAmber', 'uSettled', 'uFlicker', 'uFade']) });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  lines.renderOrder = 1;
  scene.add(lines);

  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', dynamic(starBuffers.position, 3));
  starGeometry.setAttribute('aSize', dynamic(starBuffers.size, 1));
  starGeometry.setAttribute('aBright', dynamic(starBuffers.bright, 1));
  starGeometry.setAttribute('aKind', dynamic(starBuffers.kind, 1));
  starGeometry.setDrawRange(0, 0);
  const starMaterial = new ShaderMaterial({ ...common, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, uniforms: pick(['uScale', 'uFront', 'uColor', 'uValidator']) });
  const stars = new Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = 2;
  scene.add(stars);

  // ── state ──
  let agents = [];
  let agentsRecord = null;
  let open = [];
  let settled = [];
  let validators = [];
  let placed = { stars: [], index: new Map() };
  let drawn = { lines: [], omitted: 0 };
  const seen = new Map(); // dispute key → when this page first saw it disputed, in scene seconds
  let best = null;
  let finalized = null;
  let lastHead = null;
  let scrollY = 0;
  let startedAt = null;
  let lastFrameAt = null;
  let stopped = false;
  const durations = [];
  const secondFps = [];
  let secondStart = null;
  let secondFrames = 0;

  const now = () => (startedAt === null ? 0 : (win.performance.now() - startedAt) / 1000);

  // ── colours ──
  function colours() {
    const dark = ctx.theme.isDark();
    const c = (name, fallback) => model.parseColor(ctx.theme.color(name)) ?? fallback;
    uniforms.uColor.value = c('text', [0.9, 0.92, 0.95]);
    uniforms.uValidator.value = c('live', [0.44, 0.83, 0.78]);
    uniforms.uOpen.value = c('active', [0.44, 0.83, 0.78]);
    uniforms.uAmber.value = c('disputed', [0.91, 0.77, 0.42]);
    uniforms.uSettled.value = c('settled', [0.54, 0.59, 0.66]);
    uniforms.uGlow.value = c('live', [0.44, 0.83, 0.78]);
    const blending = dark ? AdditiveBlending : NormalBlending;
    for (const m of [frontMaterial, lineMaterial, starMaterial]) {
      m.blending = blending;
      m.needsUpdate = true;
    }
    // The settled region and the marker, as CSS: the colours here, the place in `--sky-marker`.
    const rgba = ([r, g, b], a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    const tint = rgba(uniforms.uSettled.value, dark ? 0.07 : 0.09);
    const clear = rgba(uniforms.uSettled.value, 0);
    const line = rgba(uniforms.uGlow.value, dark ? 0.14 : 0.2);
    settledLayer.style.backgroundImage =
      `linear-gradient(to right, transparent calc(var(--sky-marker) - 1px), ${line} calc(var(--sky-marker) - 1px), ${line} var(--sky-marker), transparent var(--sky-marker)), ` +
      `linear-gradient(to right, ${tint} 0, ${tint} calc(var(--sky-marker) - 4%), ${clear} var(--sky-marker))`;
    placeMarker();
  }

  function placeMarker() {
    settledLayer.style.setProperty('--sky-marker', `${(((markerState.x + 1) / 2) * 100).toFixed(2)}%`);
  }

  // ── layout ──
  /** A star's world position: within the frustum at its own depth, so its place on screen holds whatever the depth. */
  function worldOf(star, aspect) {
    const distance = NEAR + star.depth * RANGE;
    const halfH = Math.tan((FOV * Math.PI) / 360) * distance * OVERFILL;
    const halfW = halfH * aspect;
    return [(2 * star.x - 1) * halfW, (1 - 2 * star.y) * halfH, -distance];
  }

  function fit() {
    const width = Math.max(1, Math.round(win.innerWidth || html.clientWidth));
    const height = Math.max(1, Math.round(win.innerHeight || html.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    uniforms.uScale.value = orbit;
    layout();
  }

  function layout() {
    const aspect = camera.aspect;
    const n = placed.stars.length;
    const { position, size, bright, kind } = starBuffers;
    placed.stars.forEach((star, i) => {
      position.set(worldOf(star, aspect), i * 3);
      size[i] = star.size;
      bright[i] = star.bright;
      kind[i] = star.kind;
    });
    for (const name of ['position', 'aSize', 'aBright', 'aKind']) starGeometry.getAttribute(name).needsUpdate = true;
    starGeometry.setDrawRange(0, n);

    const m = Math.min(MAX_LINES, drawn.lines.length);
    const { position: lp, state, t0 } = lineBuffers;
    for (let i = 0; i < m; i += 1) {
      const line = drawn.lines[i];
      lp.set(position.subarray(line.from * 3, line.from * 3 + 3), i * 6);
      lp.set(position.subarray(line.to * 3, line.to * 3 + 3), i * 6 + 3);
      state[i * 2] = line.state;
      state[i * 2 + 1] = line.state;
      t0[i * 2] = line.t0;
      t0[i * 2 + 1] = line.t0;
    }
    for (const name of ['position', 'aState', 'aT0']) lineGeometry.getAttribute(name).needsUpdate = true;
    lineGeometry.setDrawRange(0, m * 2);
  }

  /** Recomputes stars and lines from the latest reads, then the footer's line. */
  function rebuild() {
    const recentSettled = model.recentSettlements(settled, { best });
    placed = model.starsFor(agents, validators, { best, recentSettled });
    drawn = model.linesFor(open, settled, placed.index, { best, now: now(), seen });
    layout();
    if (note && agentsRecord) {
      const settledShown = drawn.lines.filter((l) => l.state === 2).length;
      ctx.readout.showValue(note, agentsRecord, {
        value: agents.length,
        unit: agents.length === 1 ? 'star' : 'stars',
        extra: model.skyExtra({ validators: validators.length, lines: drawn.lines.length - settledShown, omitted: drawn.omitted, settled: settledShown, complete: agentsRecord.complete !== false }),
        motion: ctx.motion,
        live: false,
      });
    }
    report();
  }

  // ── motion ──
  function placeCamera(t) {
    const theta = ((t / 60) * model.DRIFT_DEG_PER_MIN * Math.PI) / 180;
    const parallax = -(scrollY / Math.max(1, win.innerHeight || 1)) * PARALLAX;
    camera.position.set(centre.x + orbit * Math.sin(theta), parallax, centre.z + orbit * Math.cos(theta));
    camera.lookAt(centre);
  }

  function render() {
    if (stopped) return;
    const at = win.performance.now();
    if (startedAt === null) startedAt = at;
    const t = now();
    if (lastFrameAt !== null) {
      const d = at - lastFrameAt;
      durations.push(d);
      if (durations.length > model.STATS_WINDOW) durations.shift();
    }
    lastFrameAt = at;
    judge(at);
    uniforms.uTime.value = t;
    let inFlight = 0;
    for (let i = 0; i < FRONTS; i += 1) {
      const x = frontSlots[i].x;
      uniforms.uFront.value[i] = x;
      if (x > 1.5) continue;
      // The strip's six corners, two triangles, in clip space.
      const l = x - FRONT_HALF;
      const r = x + FRONT_HALF;
      frontBuffers.position.set([l, 1, 0, r, 1, 0, l, -1, 0, l, -1, 0, r, 1, 0, r, -1, 0], inFlight * 18);
      inFlight += 1;
    }
    frontGeometry.getAttribute('position').needsUpdate = true;
    frontGeometry.setDrawRange(0, inFlight * 6);
    placeCamera(t);
    renderer.render(scene, camera);
  }

  /** Counts frames per whole second after the warm-up; three slow seconds in a row stand the sky down. */
  function judge(at) {
    if (at - startedAt < model.WARMUP_MS) return;
    if (secondStart === null) secondStart = at;
    secondFrames += 1;
    if (at - secondStart >= 1000) {
      secondFps.push((secondFrames * 1000) / (at - secondStart));
      if (secondFps.length > 10) secondFps.shift();
      secondStart = at;
      secondFrames = 0;
      report();
      if (model.fpsTooLow(secondFps)) {
        const fps = Math.round(secondFps.slice(-model.SLOW_SECONDS).reduce((s, f) => s + f, 0) / model.SLOW_SECONDS);
        stop(`no sky: this device drew it at ${fps} frames a second for ${model.SLOW_SECONDS} seconds, so the hero stands`);
      }
    }
  }

  function report() {
    const stats = model.frameStats(durations);
    canvas.dataset.frames = String(stats.frames);
    canvas.dataset.fps = stats.fps === null ? '' : String(stats.fps);
    canvas.dataset.worstMs = stats.worstMs === null ? '' : String(stats.worstMs);
    canvas.dataset.stars = String(placed.stars.length);
    canvas.dataset.lines = String(drawn.lines.length);
    canvas.dataset.seconds = secondFps.map((f) => f.toFixed(1)).join(' ');
  }

  /** One light front per block, right to left; the oldest in flight is reused when all three are. */
  function front() {
    if (ctx.motion.reduced()) return;
    const slot = frontSlots.find((s) => s.x > 1.5) ?? frontSlots.reduce((a, b) => (a.x < b.x ? a : b));
    gsap.killTweensOf(slot);
    gsap.fromTo(slot, { x: 1.15 }, { x: -1.15, duration: model.FRONT_MS / 1000, ease: 'none', onComplete: () => { slot.x = 2; } });
  }

  function marker() {
    if (best === null || finalized === null) return;
    const x = model.markerX(best - finalized);
    gsap.killTweensOf(markerState);
    if (ctx.motion.reduced()) {
      markerState.x = x;
      placeMarker();
    } else gsap.to(markerState, { x, duration: MARKER_MS / 1000, ease: 'power2.out', onUpdate: placeMarker });
  }

  // ── lifecycle ──
  function pause() {
    gsap.ticker.remove(render);
    gsap.globalTimeline.pause();
    lastFrameAt = null;
    secondStart = null;
    secondFrames = 0;
  }

  function resume() {
    if (stopped) return;
    gsap.globalTimeline.resume();
    lastFrameAt = null;
    gsap.ticker.add(render);
  }

  function stop(why) {
    if (stopped) return;
    stopped = true;
    pause();
    for (const slot of frontSlots) gsap.killTweensOf(slot);
    gsap.killTweensOf(markerState);
    for (const g of [starGeometry, lineGeometry, frontGeometry]) g.dispose();
    for (const m of [starMaterial, lineMaterial, frontMaterial]) m.dispose();
    renderer.dispose();
    canvas.remove();
    settledLayer.remove();
    for (const off of offs) off();
    onFallback(why);
  }

  // ── data: the plates' own reads, on their own schedules ──
  const offs = [];
  offs.push(
    ctx.watchAll(
      'agents',
      (record) => {
        agentsRecord = record;
        const ok = ctx.readout.apply(note ? [note] : [], record, () => {
          agents = record.items.map((item) => ({
            address: ctx.field(item, 'address'),
            stakePlancks: ctx.field(item, 'stakePlancks'),
            activeEscrowCount: ctx.field(item, 'activeEscrowCount'),
            lastHeartbeatBlock: ctx.field(item, 'lastHeartbeatBlock'),
          }));
        });
        if (!ok) agents = []; // a failed read empties the sky: no stale stars
        rebuild();
      },
      AGENTS_INTERVAL_MS,
      { maxPages: AGENT_PAGES },
    ),
  );
  offs.push(
    ctx.watchAll(
      'escrows',
      (record) => {
        try {
          open = record.ok
            ? record.items.map((item) => ({
                buyer: ctx.field(item, 'buyer'),
                provider: ctx.field(item, 'provider'),
                seq: ctx.field(item, 'seq'),
                status: ctx.field(item, 'status'),
              }))
            : [];
        } catch {
          open = [];
        }
        rebuild();
      },
      ESCROWS_INTERVAL_MS,
      { maxPages: ESCROW_PAGES },
    ),
  );
  offs.push(
    ctx.watchAll(
      'deliveriesConfirmed',
      (record) => {
        try {
          settled = record.ok
            ? record.items.map((item) => ({
                blockNumber: ctx.field(item, 'blockNumber'),
                buyer: ctx.field(item, 'data.buyer'),
                provider: ctx.field(item, 'data.provider'),
                seq: ctx.field(item, 'data.seq'),
              }))
            : [];
        } catch {
          settled = [];
        }
        rebuild();
      },
      SETTLED_INTERVAL_MS,
      { maxPages: SETTLED_PAGES },
    ),
  );
  offs.push(
    ctx.watch(
      'validators',
      (record) => {
        try {
          validators = record.ok ? model.validatorAddresses(record.data, ctx.field) : [];
        } catch {
          validators = [];
        }
        rebuild();
      },
      VALIDATORS_INTERVAL_MS,
    ),
  );

  // A block is a block whether it came as a live header or a polled height.
  const onHeight = ({ number, finalized: fin }) => {
    if (Number.isFinite(fin)) finalized = fin;
    if (!Number.isFinite(number) || number === lastHead) return;
    lastHead = number;
    best = number;
    marker();
    if (doc.hidden) return;
    front();
  };
  const onFinal = ({ number }) => {
    if (!Number.isFinite(number)) return;
    finalized = number;
    marker();
  };
  const onScroll = () => {
    scrollY = win.scrollY || 0;
  };
  const onResize = () => fit();
  const onTheme = () => colours();
  const onVisibility = ({ hidden }) => (hidden ? pause() : resume());
  offs.push(ctx.bus.on('head', onHeight));
  offs.push(ctx.bus.on('poll', onHeight));
  offs.push(ctx.bus.on('finalized', onFinal));
  offs.push(ctx.bus.on('theme', onTheme));
  offs.push(ctx.bus.on('visibility', onVisibility));
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize);
  offs.push(() => win.removeEventListener('scroll', onScroll));
  offs.push(() => win.removeEventListener('resize', onResize));
  ctx.motion.onChange((reduced) => {
    if (reduced) stop('no sky: reduced motion is now preferred, so the hero stands');
  });

  colours();
  fit();
  onScroll();
  if (!doc.hidden) resume();

  return {
    canvas,
    stop,
    stats: () => model.frameStats(durations),
    seconds: () => secondFps.slice(),
    stars: () => placed.stars.length,
    lines: () => drawn.lines.length,
  };
}
