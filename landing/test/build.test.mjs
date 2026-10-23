// The gate for issue #74 is `npm ci && npm run build`, so the build script
// itself is under test: it must emit a self-contained static site into the
// output directory and must refuse to emit a page with unresolved content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const landingDir = fileURLToPath(new URL('../', import.meta.url));

test('npm run build emits a self-contained static site', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-build-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: landingDir,
    env: { ...process.env, LANDING_OUT_DIR: out },
    stdio: 'pipe',
  });

  const files = readdirSync(out);
  for (const name of ['index.html', 'styles.css', 'refresh.js', 'favicon.svg', 'og.png']) {
    assert.ok(files.includes(name), `build produced no ${name} (got: ${files.join(', ')})`);
  }
  for (const font of ['inter-latin-wght-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']) {
    assert.ok(statSync(join(out, 'fonts', font)).size > 0, `the chrome's font ${font} is copied out`);
  }

  // The home page: the plain chrome's stylesheet, its own rules inlined, and
  // exactly one script — the refresh, served as written (SITE-REDESIGN.md §7).
  const indexHtml = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(indexHtml, /^<!doctype html>/i);
  assert.match(indexHtml, /<link rel="stylesheet" href="\/styles\.css">/);
  assert.deepEqual([...indexHtml.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script type="module" src="/refresh.js">'], 'one plain module script, no bundle');
  assert.ok(!/nw-|chrome-legacy/.test(indexHtml), 'nothing of the Ledger chrome is on the home page');

  const css = readFileSync(join(out, 'styles.css'), 'utf8');
  assert.ok(css.length > 0, 'styles.css is empty');
  assert.match(css, /--font-sans:\s*"Inter Variable"/, 'styles.css is the plain chrome');
  assert.ok(!/\.nw-|Source Serif|IBM Plex/.test(css), 'styles.css carries nothing of the Ledger');

  const refresh = readFileSync(join(out, 'refresh.js'));
  assert.ok(refresh.equals(readFileSync(join(landingDir, 'src/home/refresh.js'))), 'refresh.js is copied as it is, not bundled');
  assert.ok(refresh.length <= 6 * 1024, `refresh.js is ${refresh.length} bytes; the budget is 6 KB`);
  assert.ok(indexHtml.length + css.length + refresh.length < 150 * 1024, 'the home page stays within its 150 KB budget before fonts');
});
