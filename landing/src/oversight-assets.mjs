// The stylesheet /oversight ships: the observatory's design system and
// instrument rules, then the page's own. Shared by the site build
// (scripts/pages/oversight.mjs) and the standalone emitter so the two cannot
// drift — the standalone copy is evidence, and evidence that looks different
// from the page it came from is worth less. Lives beside observatory-assets.mjs
// rather than in it: the observatory's files belong to the observatory phase.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { observatoryCss } from './observatory-assets.mjs';

export function oversightCss() {
  return `${observatoryCss()}\n/* ── oversight.css ── */\n${readFileSync(
    fileURLToPath(new URL('./oversight.css', import.meta.url)),
    'utf8',
  )}`;
}
