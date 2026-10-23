/**
 * The site's favicon, served by the explorer at `/favicon.svg`. A copy of
 * `landing/public/favicon.svg` (a test holds the two equal), kept as a string
 * so the built service needs no file beside `dist/`.
 */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1457d6"/><path d="M21.5 11.2c-.9-1.6-2.8-2.7-5.3-2.7-3.2 0-5.4 1.7-5.4 4.1 0 2.3 1.6 3.4 4.9 4.1l1.3.3c2.1.4 2.9 1 2.9 2.1 0 1.3-1.4 2.3-3.5 2.3-2 0-3.5-.9-4.1-2.4" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/></svg>\n';

/**
 * The copy buttons' behaviour (`landing/src/chrome/behaviour/copy.js`), inlined
 * as one small classic script: a `[data-copy]` click puts the value on the
 * clipboard and says "Copied" for a moment. Nothing else on the explorer runs
 * in the browser.
 */
export const COPY_SCRIPT =
  "document.addEventListener('click',async function(e){var b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;try{await navigator.clipboard.writeText(b.getAttribute('data-copy'));var w=b.querySelector('span');if(w){w.textContent='Copied';setTimeout(function(){w.textContent='Copy'},1200)}}catch(_){}});";
