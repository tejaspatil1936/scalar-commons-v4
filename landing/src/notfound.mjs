// /404 (SITE-REDESIGN.md §5.4): "Page not found", one sentence naming the
// path, two links (Home, Docs) and the docs search field. Nothing else.
//
// nginx serves this file for every unknown path (error_page 404 /404.html),
// so the address bar holds the path that was asked for and every URL the page
// uses is absolute. The sentence names the path in the browser; with scripts
// off it reads "There's nothing at this address." The search field is a GET
// form to the docs: with scripts on it lists the docs pages that match, from
// an index of the docs' titles and headings taken at build time
// (src/notfound/docs-index.mjs); with scripts off it opens the docs home,
// which lists every page.
import { button, escapeHtml, page, searchField } from './chrome/templates.mjs';

export const TITLE = 'Page not found';
export const DESCRIPTION = 'There is no page at this address on scalarnet.io.';
export const SENTENCE_BEFORE = 'There’s nothing at ';
export const PATH_FALLBACK = 'this address';
export const SEARCH_LABEL = 'Search the docs';

export function renderNotFound({ facts, css, builtAt, docs = [] }) {
  const index = JSON.stringify(docs.map(({ title, path, description, headings }) => ({ title, path, description, headings }))).replace(/</g, '\\u003c');
  const body = `<div class="sc-container">
  <div class="nf sc-reading">
    <div class="sc-page-head">
      <h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
      <p class="sc-lead">${escapeHtml(SENTENCE_BEFORE)}<span class="nf-path" data-path>${escapeHtml(PATH_FALLBACK)}</span>.</p>
    </div>
    <div class="nf-body">
      <div class="sc-actions">${button({ text: 'Home', href: '/' })}${button({ text: 'Docs', href: '/docs/', variant: 'secondary' })}</div>
      <div class="nf-search" data-docs-search>
        ${searchField({ action: '/docs/', name: 'q', placeholder: SEARCH_LABEL, label: SEARCH_LABEL })}
        <div class="nf-results" data-results aria-live="polite" hidden></div>
      </div>
    </div>
  </div>
</div>
<script type="application/json" id="nf-docs">${index}</script>`;
  return page({
    title: TITLE,
    description: DESCRIPTION,
    path: '/404',
    current: null,
    facts,
    builtAt,
    body,
    css,
    scripts: ['/404.js'],
    extraHead: '\n<meta name="robots" content="noindex">',
  });
}
