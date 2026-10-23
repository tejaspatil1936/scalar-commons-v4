// TRANSITIONAL: the Observatory's assets are gone. scripts/build-oversight-standalone.mjs
// still imports FONTS from here; they are the Ledger faces chrome-legacy lists.
// Delete this module with chrome-legacy in the oversight phase.
export { CHROME_FONTS as FONTS } from './chrome-legacy/assets.mjs';
