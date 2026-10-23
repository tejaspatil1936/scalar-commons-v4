// The 404 page's one script: the path asked for, and the closest built route.
import { initChrome } from '../chrome-legacy/behaviour/index.js';
import { closestRoute } from './routes.js';

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
