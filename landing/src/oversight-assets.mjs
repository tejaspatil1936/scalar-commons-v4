// The stylesheet /oversight ships: the chrome (tokens + chrome + print), then
// the page's own. Shared by the site build (scripts/pages/oversight.mjs) and
// the standalone emitter so the two cannot drift — the standalone copy is
// evidence, and evidence that looks different from the page it came from is
// worth less.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromeCss } from './chrome/assets.mjs';

export function oversightCss() {
  return `${chromeCss()}\n/* ── oversight.css ── */\n${readFileSync(fileURLToPath(new URL('./oversight.css', import.meta.url)), 'utf8')}`;
}
