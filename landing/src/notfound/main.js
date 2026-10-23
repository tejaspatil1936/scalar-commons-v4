// The 404 page's one script: the path asked for, and the closest built route.
import { initChrome } from '../chrome/behaviour/index.js';

/** Levenshtein distance, small inputs. */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** The nearest route, or null when none is close (more than half the path away). */
export function closestRoute(path, routes) {
  const clean = path.replace(/\/+$/, '') || '/';
  let best = null;
  for (const route of routes) {
    const candidate = route.replace(/\/+$/, '') || '/';
    const distance = editDistance(clean.toLowerCase(), candidate.toLowerCase());
    if (best === null || distance < best.distance) best = { route, distance };
  }
  return best && best.distance <= Math.max(2, Math.floor(clean.length / 2)) ? best.route : null;
}

function fill(key, value, { href = null } = {}) {
  const el = document.querySelector(`[data-reading="${key}"]`);
  if (!el) return;
  const slot = el.querySelector('[data-reading-value]');
  el.classList.remove('is-loading');
  if (value === null) {
    el.classList.add('is-unavailable');
    slot.textContent = 'none close';
    return;
  }
  slot.textContent = value;
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    slot.replaceWith(a);
    a.appendChild(slot);
  }
  const fetched = el.querySelector('[data-fetched]');
  if (fetched) fetched.textContent = `fetched ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} · in your browser`;
}

initChrome();
const main = document.querySelector('main[data-routes]');
const routes = (main?.getAttribute('data-routes') ?? '').split(' ').filter(Boolean);
const path = window.location.pathname;
fill('askedFor', path);
const closest = closestRoute(path, routes);
if (closest === null) document.querySelector('[data-reading="closest"]')?.remove();
else fill('closest', closest, { href: closest });
