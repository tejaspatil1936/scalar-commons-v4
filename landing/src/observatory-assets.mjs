// TRANSITIONAL (SITE-REDESIGN.md phase 3): the observatory's stylesheet and
// instruments are gone with the page. This module remains only because
// scripts/build-oversight-standalone.mjs still takes the Ledger's font list
// from it; those faces now live in src/chrome-legacy/assets.mjs, which the
// oversight phase deletes along with this file.
export { CHROME_FONTS as FONTS } from './chrome-legacy/assets.mjs';
