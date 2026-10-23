// Honesty tests for the home page.
//
// The page is the public face of a chain that runs real money on its mainnet
// one day, so the risk here is not a broken build — it is a true-sounding
// sentence the runtime does not back. These tests make that mechanical: every
// figure must come from metadata read off a live node, every module named must
// exist in that metadata, every descriptive sentence must cite a snippet that
// is still present in the repo on the line it was verified at, and a fixed
// list of unearned marketing claims must never appear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { content } from '../src/content.mjs';
import { sourceClaims, sourceClaimsByKey } from '../src/source-claims.mjs';
import { renderPage, proseOf, placeholdersIn, resolve } from '../src/render.mjs';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const repoRoot = new URL('../../', import.meta.url);
const html = renderPage({ facts, content, sourceClaims });

const readRepoFile = (relPath) => readFileSync(new URL(relPath, repoRoot), 'utf8');

/** Every node of the content tree that carries a `sources` list, with where it sits. */
function cited(node, path = '') {
  const out = [];
  if (Array.isArray(node)) node.forEach((item, i) => out.push(...cited(item, `${path}[${i}]`)));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'sources' || key === 'thesisSources') out.push([path, value]);
      else out.push(...cited(value, path ? `${path}.${key}` : key));
    }
  }
  return out;
}

test('chain-facts.json is stamped as live runtime metadata, not hand-authored', () => {
  const p = facts.provenance;
  assert.equal(p.source, 'live-runtime-metadata');
  assert.match(p.rpc, /^wss?:\/\//);
  assert.equal(p.specName, 'scalar-commons');
  assert.ok(Number.isInteger(p.specVersion) && p.specVersion > 0, 'specVersion must be an integer');
  assert.ok(p.metadataVersion >= 14, `metadata v${p.metadataVersion} is older than the v14 type registry`);
  assert.match(p.genesisHash, /^0x[0-9a-f]{64}$/);
  assert.match(p.readAtBlockHash, /^0x[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(p.readAtBlock) && p.readAtBlock > 0);
  assert.ok(Number.isInteger(p.finalizedAtRead) && p.finalizedAtRead > 0, 'the finalized height the stats row starts from');
  assert.equal(facts.token.symbol, 'CMN');
  assert.equal(facts.token.decimals, 12);
});

test('every placeholder in the page content resolves against chain-facts.json', () => {
  let count = 0;
  for (const [where, str] of proseOf(content)) {
    for (const token of placeholdersIn(str)) {
      count += 1;
      const value = resolve(facts, token);
      assert.ok(
        value !== undefined && value !== null && String(value).length > 0,
        `${where}: placeholder {{${token}}} does not resolve against chain-facts.json`,
      );
    }
  }
  assert.ok(count >= 30, `the page states its figures through placeholders (${count} found)`);
  assert.throws(() => resolve(facts, 'token.symbol|sparkle'), /unknown filter/);
  assert.equal(resolve(facts, 'nothing.here'), undefined);
});

test('no chain figure is hand-typed: prose carries digits only through placeholders', () => {
  for (const [where, str] of proseOf(content)) {
    const withoutPlaceholders = str.replace(/\{\{[^}]+\}\}/g, '');
    assert.ok(
      !/\d/.test(withoutPlaceholders),
      `${where}: literal digits in prose ("${withoutPlaceholders.match(/[^.]*\d[^.]*/)?.[0]?.trim()}") — ` +
        'every number must come from chain-facts.json via a {{placeholder}}',
    );
    // Spelled-out counts are hand-typed figures too (§6): "eight validators" is "{{state.validators}} validators".
    assert.ok(
      !/\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred|thousand|million|billion)\s+(?:validators?|agents?|blocks?|eras?|hours?|days?|modules?|pallets?|seats?|CMN)\b/i.test(withoutPlaceholders),
      `${where}: a spelled-out count ("${withoutPlaceholders}")`,
    );
  }
});

test('the filters render the way the words say: CMN exact, basis points as "5 %", blocks as hours and days', () => {
  assert.equal(resolve(facts, 'constants.agents.minStake|cmn'), '1,000');
  assert.equal(resolve(facts, 'constants.messages.baseFee|cmn'), '0.02');
  assert.equal(resolve(facts, 'constants.emissions.supplyCap|cmnCompact'), '100 B');
  assert.equal(resolve(facts, 'constants.orchestrator.maxOrchestratorFeeBps|percent'), '5 %');
  assert.equal(resolve(facts, 'constants.emissions.oracleBonusBps|pct'), '20 %');
  assert.equal(resolve(facts, 'constants.emissions.eraDuration|hours'), '6 h');
  assert.equal(resolve(facts, 'constants.emissions.eraDuration|hoursN'), '6');
  assert.equal(resolve(facts, 'constants.agents.unstakeCooldown|days'), '7 days');
  assert.equal(resolve(facts, 'constants.escrow.buyerResponseWindow|blocks'), '3 days');
  assert.equal(resolve(facts, 'provenance.readAtBlock|commas'), new Intl.NumberFormat('en-US').format(facts.provenance.readAtBlock));
  assert.match(resolve(facts, 'provenance.fetchedAt|utc'), /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/);
});

test('every runtime module the table names exists in live metadata, and every sentence cites a pinned source', () => {
  const refs = content.onChain.rows.flatMap((r) => r.chainRefs ?? []);
  assert.ok(refs.length >= 7, 'the table names the runtime modules it describes');
  for (const ref of refs) {
    assert.ok(facts.pallets.some((p) => p.name === ref), `content cites pallet "${ref}" which is absent from live metadata`);
  }
  const citations = cited(content);
  assert.ok(citations.length >= 10, 'the mechanism sentences cite their sources');
  const used = new Set();
  for (const [where, keys] of citations) {
    assert.ok(Array.isArray(keys) && keys.length > 0, `${where} cites nothing`);
    for (const key of keys) {
      assert.ok(sourceClaimsByKey[key], `${where} cites "${key}", which src/source-claims.mjs does not pin`);
      used.add(key);
    }
  }
  const unused = sourceClaims.map((r) => r.key).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], `source claims no sentence cites: ${unused.join(', ')}`);
  assert.throws(
    () => renderPage({ facts, content: { ...content, how: { ...content.how, steps: [{ ...content.how.steps[0], sources: ['made-up'] }] } }, sourceClaims }),
    /cites source claim "made-up"/,
  );
});

test('each descriptive claim is grounded in a snippet still present in the repo, on the line it was verified at', () => {
  assert.ok(sourceClaims.length > 0);
  const keys = sourceClaims.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, 'source claim keys are unique');
  for (const claim of sourceClaims) {
    assert.ok(claim.key && claim.claim && claim.file && claim.snippet && claim.line, `source claim "${claim.key}" is missing key/claim/file/line/snippet`);
    const source = readRepoFile(claim.file);
    assert.ok(source.includes(claim.snippet), `claim "${claim.claim}" cites ${claim.file} for \`${claim.snippet}\`, which is no longer there`);
    for (const row of [claim, ...(claim.also ?? [])]) {
      const lines = readRepoFile(row.file).split('\n');
      assert.ok(
        (lines[row.line - 1] ?? '').includes(row.snippet),
        `claim "${claim.claim}" cites ${row.file}:${row.line} for \`${row.snippet}\`, but that line now reads: ${(lines[row.line - 1] ?? '').trim()} — correct the line, never the claim`,
      );
    }
  }
});

test('the page makes no claim the runtime does not implement', () => {
  // Each pattern is an affirmative claim this runtime cannot back: no halving
  // or decay schedule exists, there is no yield product, no sale, no audit and
  // no mainnet. The figures are design-prompt specimens (never a figure on a
  // built page) and the banned words of SITE-REDESIGN.md §1.
  const forbidden = [
    /halving/i,
    /\bAPY\b/i,
    /\bROI\b/i,
    /passive income/i,
    /guaranteed/i,
    /risk-free/i,
    /\baudited\b/i,
    /security audit/i,
    /presale|pre-sale|token sale|\bICO\b/i,
    /airdrop/i,
    /mainnet is live/i,
    /price/i,
    /1,115,263/,
    /6,054,836,317/,
    /\bera 141\b/,
    /\bagents? 214\b/,
    /214 agents/,
    /5GbFZC[^<\s]*8pcj/,
    /swarm-\d{4}\b/,
    /seamless|cutting-edge|revolutionary|unlock|empower|supercharge|next-gen|blazing/i,
    /trusted by/i,
    /!/,
  ];
  const visible = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(visible), `rendered page matches forbidden claim ${pattern}`);
  }
});

test('the inert oracle-accuracy term is disclosed for as long as it stays unwired', () => {
  const runtime = readRepoFile('runtime/src/lib.rs');
  assert.ok(
    runtime.includes('type OracleScoreProvider = ();'),
    'OracleScoreProvider is now wired — update the oracle caveat in src/content.mjs instead of deleting this test',
  );
  assert.match(html, /data-caveat="oracle-score-provider"/, 'the oracle-accuracy term contributes zero on this runtime and the page must say so');
  assert.match(html, /data-caveat="economic-gate"/, 'the failed economic gate is disclosed until it is re-measured');
});

test('docs, explorer, faucet and the repository are all linked from the page', () => {
  for (const [name, pattern] of [
    ['docs', /href="\/docs\//],
    ['explorer', /href="https:\/\/explorer\.scalarnet\.io\//],
    ['faucet', /href="\/faucet"/],
    ['repo', /href="https:\/\/github\.com\/[^"]+" rel="noopener"/],
    ['network', /href="\/network"/],
  ]) {
    assert.match(html, pattern, `the page must link ${name}`);
  }
});

test('the rendered document is complete and fully resolved', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/);
  assert.ok(!html.includes('{{'), 'rendered page still contains an unresolved template token');
  assert.ok(!/TODO|FIXME|lorem ipsum/i.test(html), 'rendered page contains placeholder copy');
  assert.match(html, /coordination infrastructure/i);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+"/);
  assert.throws(
    () => renderPage({ facts, content: { ...content, hero: { ...content.hero, caption: '{{state.nothing}} validators' } }, sourceClaims }),
    /unresolved placeholder \{\{state\.nothing\}\}/,
  );
});

test('the committed chain snapshot comes from the long-running devnet, not the genesis window', () => {
  // chain-facts.json is what makes the page offline-reproducible, and it is
  // also the thing that silently rots. This floor only ever moves up, and
  // re-running `npm run fetch:chain-facts` against the devnet clears it.
  const MIN_READ_AT_BLOCK = 400_000;
  assert.ok(
    facts.provenance.readAtBlock > MIN_READ_AT_BLOCK,
    `chain-facts.json was read at block ${facts.provenance.readAtBlock}, at or below the stale floor of ` +
      `${MIN_READ_AT_BLOCK} — re-run \`npm run fetch:chain-facts\` against the devnet`,
  );
});
