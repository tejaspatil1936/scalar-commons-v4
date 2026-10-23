// The 404 page's one script: name the path that was asked for, and answer the
// docs search field in place with the matching docs pages.
import { escapeHtml } from '../chrome/templates.mjs';
import { searchDocs } from './search.js';

const slot = document.querySelector('[data-path]');
let path = window.location.pathname;
try {
  path = decodeURIComponent(path);
} catch {
  // a malformed escape: show the path as the browser holds it
}
// Opened at its own address, the page has no other path to name.
if (slot && !/^\/404(?:\.html)?$/.test(path)) slot.textContent = path;

const search = document.querySelector('[data-docs-search]');
const form = search?.querySelector('form');
const results = search?.querySelector('[data-results]');
let index = [];
try {
  index = JSON.parse(document.getElementById('nf-docs')?.textContent ?? '[]');
} catch {
  index = [];
}

form?.addEventListener('submit', (event) => {
  const query = String(new FormData(form).get('q') ?? '').trim();
  // Nothing typed, or no index: let the form open the docs home.
  if (!query || !index.length) return;
  event.preventDefault();
  const found = searchDocs(index, query);
  const quoted = `“${escapeHtml(query)}”`;
  results.innerHTML = found.length
    ? `<p class="sc-small sc-muted">${found.length === 1 ? 'One docs page matches' : `${found.length} docs pages match`} ${quoted}.</p><ul>${found
        .map((p) => `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a>${p.description ? `<p class="sc-small sc-muted">${escapeHtml(p.description)}</p>` : ''}</li>`)
        .join('')}</ul>`
    : `<p class="sc-small sc-muted">No docs page matches ${quoted}. <a href="/docs/">Browse the docs</a>.</p>`;
  results.hidden = false;
});
