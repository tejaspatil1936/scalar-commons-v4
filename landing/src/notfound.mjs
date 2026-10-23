// Renders /404 (SITE-REDESIGN.md §5.4): "Page not found", one sentence that
// names the path asked for, and three links. nginx serves it for any unknown
// path through `error_page 404 /404.html`, so the page carries no script file
// and no relative asset URL — the two-line inline script below is the only
// behaviour, and it falls back to "this address" when there is no path to
// show (scripts off, or the page opened at /404 itself).
import { escapeHtml, link, page } from './chrome/templates.mjs';

export const TITLE = 'Page not found';
export const DESCRIPTION = 'There is no page at this address on scalarnet.io.';
export const SENTENCE = { before: 'There’s nothing at', fallback: 'this address', after: '.' };
export const LINKS = [
  { text: 'Home', href: '/' },
  { text: 'Docs', href: '/docs/' },
  { text: 'Search the docs', href: '/docs/' },
];

/** The sentence's path, from the address bar; `/404` itself keeps the fallback. */
const SCRIPT = `<script>var p=document.querySelector("[data-path]"),l=location.pathname;
if(p&&l&&l!=="/404"&&l!=="/404.html")p.textContent=l;</script>`;

export function renderNotFound({ facts, css, builtAt }) {
  const body = `<div class="sc-container">
  <div class="sc-page-head">
    <h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
    <p class="sc-lead">${escapeHtml(SENTENCE.before)} <span data-path>${escapeHtml(SENTENCE.fallback)}</span>${escapeHtml(SENTENCE.after)}</p>
    <ul class="sc-stack" aria-label="Where to go">${LINKS.map((l) => `<li>${link(l)}</li>`).join('')}</ul>
  </div>
  ${SCRIPT}
</div>`;
  return page({ title: TITLE, description: DESCRIPTION, path: '/404', current: null, facts, builtAt, body, css });
}
