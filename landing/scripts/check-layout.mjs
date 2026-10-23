// The alignment check (SITE-ROUND2.md §2.8). Serves the built landing site and
// the docs build, starts the explorer against the public chain, opens every
// page at 1440 and 390 px, waits for live figures, and fails on:
//   (a) two sibling Readings (or two figures) whose boxes intersect;
//   (b) a figure, with its stub, wider than its column;
//   (c) document.scrollWidth wider than the viewport;
//   (d) a font-size or a spacing value computed on a Reading, a Ledger or the
//       bar (and everything inside them) that is not on the scales;
//   (e) a computed color or background-color that is not a Ledger token.
// Each violation prints with the page, the width, a selector and the numbers.
//
//   node scripts/check-layout.mjs [--root DIR] [--only key,key] [--widths 1440,390]
//                                 [--wait 10000] [--explorer-url URL | --no-explorer]
//
// Build first: landing `npm run build`; docs `DOCS_BASE=/docs/ npm run build`;
// explorer `npm run build`. Playwright comes from the global install (it is
// available in the session); it is not, and must not be, in any package.json.
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const ROOT = resolve(flag('--root', fileURLToPath(new URL('../../', import.meta.url))));
const WIDTHS = flag('--widths', '1440,390').split(',').map(Number);
const WAIT = Number(flag('--wait', 10_000));
const ONLY = flag('--only', null)?.split(',');
const RPC = flag('--rpc', 'wss://rpc.scalarnet.io');
const INDEXER = flag('--indexer', 'https://api.scalarnet.io');
const CHROMIUM = flag('--chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright'));

// ── the scales, read from the tokens so the check and the stylesheet never drift ──
const tokensCss = readFileSync(join(ROOT, 'landing/src/chrome/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokenValue = (name) => tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
const COLOURS = ['--paper', '--paper-2', '--paper-3', '--ink', '--ink-2', '--ink-3', '--rule', '--rule-2'].map((n) => hexToRgb(tokenValue(n)));
const remPx = (v) => Math.round(parseFloat(v) * 16 * 100) / 100;
const FONT_SIZES = ['--display', '--h2', '--h3', '--body', '--small', '--figure-xl', '--figure-l', '--figure-m', '--figure-s', '--label', '--mono'].map((n) => remPx(tokenValue(n).match(/([\d.]+)rem/)[1]));
const STEPS = Array.from({ length: 10 }, (_, i) => parseFloat(tokenValue(`--s-${i + 1}`)));
// The scale's steps, the 20 px gutter at 480 px and under (contract §2.7), and
// the sub-step drawing geometry the stylesheets write as fractions of --s-1.
const SPACING = [0, ...STEPS, 20, 1, 2, 3, 6];

// ── the pages ────────────────────────────────────────────────────────────────
const LANDING = join(ROOT, 'landing/dist');
const DOCS = join(ROOT, 'docs/.vitepress/dist');
const firstArticle = () => {
  for (const rel of ['guide/run-a-node.html', 'guide/index.html']) if (existsSync(join(DOCS, rel))) return `/docs/${rel}`;
  const dir = join(DOCS, 'guide');
  const any = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.html')) : null;
  return any ? `/docs/guide/${any}` : '/docs/';
};
const STATIC_PAGES = {
  home: '/index.html',
  observatory: '/observatory.html',
  pulse: '/pulse.html',
  faucet: '/faucet.html',
  oversight: '/oversight.html',
  404: '/no-page-is-logged-here',
  'docs-home': '/docs/',
  'docs-article': null, // resolved at run time
};
const EXPLORER_PAGES = ['explorer-home', 'explorer-block', 'explorer-extrinsic', 'explorer-account'];

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };
function serveStatic() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [base, prefix] = path.startsWith('/docs/') || path === '/docs' ? [DOCS, '/docs'] : [LANDING, ''];
    const rel = path.slice(prefix.length) || '/';
    for (const candidate of [rel, join(rel, 'index.html'), `${rel}.html`]) {
      const file = join(base, candidate);
      try {
        if (statSync(file).isFile()) {
          res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
          res.end(readFileSync(file));
          return;
        }
      } catch {
        // next candidate
      }
    }
    const notFound = join(base, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(existsSync(notFound) ? readFileSync(notFound) : '404');
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}
const freePort = () =>
  new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
async function startExplorer() {
  const given = flag('--explorer-url', null);
  if (given) return { url: given.replace(/\/$/, ''), stop: () => {} };
  const entry = join(ROOT, 'explorer/dist/index.js');
  if (!existsSync(entry)) throw new Error(`no explorer build at ${entry}: run npm run build in explorer/`);
  const port = await freePort();
  const child = spawn(process.execPath, [entry], {
    cwd: join(ROOT, 'explorer'),
    env: { ...process.env, EXPLORER_PORT: String(port), EXPLORER_RPC_ENDPOINT: RPC, EXPLORER_INDEXER_URL: INDEXER },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${url}/`);
      if (r.status < 500) return { url, stop: () => child.kill() };
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`the explorer did not start:\n${log.slice(-800)}`);
}
async function explorerTargets(url) {
  const home = await (await fetch(`${url}/`)).text();
  const block = home.match(/href="(\/block\/\d+)"/)?.[1];
  const extrinsic = home.match(/href="(\/extrinsic\/\d+\/\d+)"/)?.[1];
  let account = home.match(/href="(\/account\/[1-9A-HJ-NP-Za-km-z]{40,})"/)?.[1];
  if (!account) {
    const agents = await (await fetch(`${INDEXER}/v1/agents?limit=1`)).json();
    account = agents.items?.[0]?.address ? `/account/${agents.items[0].address}` : null;
  }
  return { 'explorer-home': '/', 'explorer-block': block, 'explorer-extrinsic': extrinsic, 'explorer-account': account };
}

// ── what runs in the page ────────────────────────────────────────────────────
function inspect({ colours, fontSizes, spacing }) {
  const out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
  };
  const sel = (el) => {
    const parts = [];
    for (let x = el; x && x !== document.body && parts.length < 4; x = x.parentElement) {
      const cls = typeof x.className === 'string' ? x.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('') : '';
      const key = x.getAttribute?.('data-reading') ? `[data-reading="${x.getAttribute('data-reading')}"]` : '';
      parts.unshift(`${x.tagName.toLowerCase()}${x.id ? `#${x.id}` : ''}${cls}${key}`);
    }
    return parts.join(' > ');
  };
  const box = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
  const meets = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

  // (a) sibling Readings, and any two figures, must not intersect
  const readings = [...document.querySelectorAll('.nw-reading')].filter(visible);
  for (let i = 0; i < readings.length; i += 1) {
    for (let j = i + 1; j < readings.length; j += 1) {
      const [a, b] = [readings[i], readings[j]];
      if (a.contains(b) || b.contains(a)) continue;
      const siblings = a.parentElement === b.parentElement || a.parentElement?.parentElement === b.parentElement?.parentElement;
      if (!siblings) continue;
      const [ra, rb] = [a.getBoundingClientRect(), b.getBoundingClientRect()];
      if (meets(ra, rb)) out.push(`(a) readings intersect: ${sel(a)} [${box(ra)}] and ${sel(b)} [${box(rb)}]`);
    }
  }
  const figures = [...document.querySelectorAll('.nw-reading-figure')].filter(visible);
  for (let i = 0; i < figures.length; i += 1) {
    for (let j = i + 1; j < figures.length; j += 1) {
      const [ra, rb] = [figures[i].getBoundingClientRect(), figures[j].getBoundingClientRect()];
      if (meets(ra, rb)) out.push(`(a) figures intersect: ${sel(figures[i])} [${box(ra)}] and ${sel(figures[j])} [${box(rb)}]`);
    }
  }
  // (b) a figure (with its unit and stub) wider than its column
  for (const fig of figures) {
    const column = fig.closest('.nw-reading') ?? fig.parentElement;
    const [rf, rc] = [fig.getBoundingClientRect(), column.getBoundingClientRect()];
    const inner = fig.querySelector('.nw-figure');
    const spill = Math.max(rf.right - rc.right, inner ? inner.scrollWidth - inner.clientWidth : 0, rf.left < rc.left - 1 ? rc.left - rf.left : 0);
    if (spill > 1) out.push(`(b) figure wider than its column by ${Math.round(spill)} px: ${sel(fig)} "${fig.textContent.trim().slice(0, 40)}" figure ${Math.round(rf.width)} px in column ${Math.round(rc.width)} px`);
  }
  // (b) also: a Reading's label wider than its column (it would run into the next one)
  for (const label of [...document.querySelectorAll('.nw-reading-line > .nw-label')].filter(visible)) {
    const column = label.closest('.nw-reading');
    const [rl, rc] = [label.getBoundingClientRect(), column.getBoundingClientRect()];
    const spill = Math.max(rl.right - rc.right, label.scrollWidth - label.clientWidth);
    if (spill > 1) out.push(`(b) label wider than its column by ${Math.round(spill)} px: ${sel(label)} "${label.textContent.trim().slice(0, 40)}"`);
  }
  // (c) no horizontal scroll; name the element that reaches furthest right
  const sw = document.documentElement.scrollWidth;
  if (sw > window.innerWidth) {
    // Content inside a scrolling or clipping box (a code block) does not widen the page.
    const clipped = (el) => {
      for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
        if (getComputedStyle(x).overflowX !== 'visible') return true;
      }
      return false;
    };
    let worst = null;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth + 1 && (!worst || r.right > worst[1]) && !clipped(el)) worst = [el, r.right];
    }
    out.push(`(c) scrollWidth ${sw} px > viewport ${window.innerWidth} px${worst ? `; furthest right: ${sel(worst[0])} reaching ${Math.round(worst[1])} px` : ''}`);
  }
  // (d) type and spacing on Readings, Ledgers and the bar
  const near = (v, list) => list.some((x) => Math.abs(Math.abs(v) - x) < 0.6);
  const scoped = [...document.querySelectorAll('.nw-reading, .nw-reading *, .nw-ledger, .nw-ledger *, .nw-bar, .nw-bar *')].filter(visible);
  const seen = new Set();
  for (const el of scoped) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    if (!near(fs, fontSizes)) {
      const k = `fs${sel(el)}`;
      if (!seen.has(k)) out.push(`(d) font-size ${fs} px off the type scale: ${sel(el)}`);
      seen.add(k);
    }
    // Horizontal margins are left out: an auto margin (the bar's right side,
    // a centred frame) computes to whatever space is left, which is no step.
    for (const prop of ['marginTop', 'marginBottom', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      const raw = s[prop];
      if (!raw || raw === 'normal' || raw === 'auto') continue;
      const v = parseFloat(raw);
      if (Number.isNaN(v) || near(v, spacing)) continue;
      const k = `${prop}${sel(el)}`;
      if (!seen.has(k)) out.push(`(d) ${prop} ${raw} off the spacing scale: ${sel(el)}`);
      seen.add(k);
    }
  }
  // (e) every computed colour is a Ledger token
  const transparent = (c) => c === 'transparent' || /rgba\(\d+, \d+, \d+, 0\)/.test(c);
  const reported = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg' || el.closest('svg')) continue;
    const s = getComputedStyle(el);
    for (const [prop, value] of [['color', s.color], ['background-color', s.backgroundColor]]) {
      if (transparent(value) || colours.includes(value)) continue;
      if (prop === 'color' && !el.textContent.trim()) continue;
      const k = `${prop}:${value}:${sel(el)}`;
      if (reported.has(k)) continue;
      reported.add(k);
      out.push(`(e) ${prop} ${value} is not a token: ${sel(el)}`);
    }
  }
  return { violations: out, readings: readings.length, figures: figures.length, scrollWidth: sw };
}

// ── run ──────────────────────────────────────────────────────────────────────
const server = await serveStatic();
const base = `http://127.0.0.1:${server.address().port}`;
STATIC_PAGES['docs-article'] = firstArticle();
const wantExplorer = !args.includes('--no-explorer') && (!ONLY || ONLY.some((k) => EXPLORER_PAGES.includes(k)));
let explorer = null;
const targets = [];
for (const [key, path] of Object.entries(STATIC_PAGES)) if (!ONLY || ONLY.includes(key)) targets.push([key, `${base}${path}`]);
if (wantExplorer) {
  explorer = await startExplorer();
  const paths = await explorerTargets(explorer.url);
  for (const key of EXPLORER_PAGES) {
    if (ONLY && !ONLY.includes(key)) continue;
    if (!paths[key]) {
      targets.push([key, null]);
      continue;
    }
    targets.push([key, `${explorer.url}${paths[key]}`]);
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
let total = 0;
const lines = [];
const runs = [];
for (const [key, url] of targets) {
  for (const width of WIDTHS) {
    runs.push(
      (async () => {
        if (!url) return [`${key}@${width}: FAIL no page to open (no link found)`, 1];
        const page = await browser.newPage({ viewport: { width, height: width >= 1024 ? 900 : 844 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
          await page.waitForTimeout(WAIT);
          const r = await page.evaluate(inspect, { colours: COLOURS, fontSizes: FONT_SIZES, spacing: SPACING });
          const head = `${key}@${width} ${url.replace(base, '').replace(explorer?.url ?? '\0', 'explorer:')} — ${r.readings} readings, ${r.figures} figures, scrollWidth ${r.scrollWidth}`;
          const body = r.violations.map((v) => `  ${v}`);
          if (errors.length) body.push(...errors.map((e) => `  (js) ${e}`));
          return [`${r.violations.length ? 'FAIL' : 'ok  '} ${head}${body.length ? `\n${body.join('\n')}` : ''}`, r.violations.length];
        } catch (e) {
          return [`FAIL ${key}@${width}: ${e.message}`, 1];
        } finally {
          await page.close();
        }
      })(),
    );
  }
}
for (const [line, n] of await Promise.all(runs)) {
  lines.push(line);
  total += n;
}
await browser.close();
server.close();
explorer?.stop();
console.log(lines.join('\n'));
console.log(total ? `\ncheck-layout: ${total} violation(s)` : '\ncheck-layout: clean');
process.exit(total ? 1 : 0);
