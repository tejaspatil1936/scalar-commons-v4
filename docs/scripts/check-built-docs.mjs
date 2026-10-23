#!/usr/bin/env node
/**
 * Check the built docs (`DOCS_BASE=/docs/ npm run build` first) against the
 * plain redesign (SITE-REDESIGN.md §5.6, Appendix A items 26–28): the default
 * theme with the shared nav and footer, the docs home as specified, articles
 * without the Ledger's chrome blocks, a plain 404, the chain spec as a
 * download, the constitution page, and every page's head. Exits 1 on a miss.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../.vitepress/dist/', import.meta.url))
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ no docs build: run `DOCS_BASE=/docs/ npm run build` first')
  process.exit(1)
}
const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!['assets', 'internal', 'ci-drafts'].includes(name)) walk(p)
    } else if (name.endsWith('.html') && name !== '404.html') pages.push(relative(DIST, p))
  }
}
walk(DIST)

const errors = []
const fail = (page, msg) => errors.push(`${page}: ${msg}`)
const read = (page) => readFileSync(join(DIST, page), 'utf8')
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ')
const navLabels = (html) =>
  [...(html.match(/<nav[^>]*class="VPNavBarMenu menu"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<span(?! id="main-nav-aria-label")[^>]*>([^<]+)<\/span>/g)].map((m) => m[1].trim())

for (const page of pages) {
  const html = read(page)
  const words = text(html)
  // the head: title "Page — Scalar Commons", description, canonical, Open Graph, favicon, lang
  if (!/<html lang="en"/.test(html)) fail(page, 'no lang="en"')
  if (!/<title>[^<]+ — Scalar Commons<\/title>/.test(html)) fail(page, 'title is not "Page — Scalar Commons"')
  for (const tag of ['name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'rel="icon"']) {
    if (!html.includes(tag)) fail(page, `no ${tag}`)
  }
  if (/color-scheme" content="dark|prefers-color-scheme: dark/.test(html)) fail(page, 'a dark scheme')
  // the nav: Network · Explorer · Docs · Faucet, then GitHub and Get started
  const nav = navLabels(html)
  if (nav.join(' · ') !== 'Network · Explorer · Docs · Faucet') fail(page, `nav is "${nav.join(' · ')}"`)
  for (const [label, href] of [['Network', 'https://scalarnet.io/network'], ['Faucet', 'https://scalarnet.io/faucet'], ['Explorer', 'https://explorer.scalarnet.io/']]) {
    if (!new RegExp(`href="${href}" target="_self"`).test(html)) fail(page, `${label} does not leave the docs for ${href}`)
  }
  if (!/class="sc-header-link" href="https:\/\/github\.com\/[^"]+" rel="noopener"/.test(html)) fail(page, 'no GitHub link')
  if ((html.match(/class="sc-btn sc-btn-primary" href="\/docs\/guide\/run-an-agent">Get started</g) ?? []).length !== 1) fail(page, 'not one Get started button')
  // the shared footer: constitution page, chain spec download, the caption line from the snapshot
  if (!/class="sc-footer"/.test(html)) fail(page, 'no site footer')
  if (!/href="\/docs\/reference\/constitution"[^>]*>Constitution</.test(html)) fail(page, 'footer does not link the constitution page')
  if (!/href="\/docs\/chainspec\.json" download="chainspec\.json">Chain spec \(download\)/.test(html)) fail(page, 'footer chain spec is not a download')
  if (!/Testnet — tokens have no value and the chain may be reset\. Runtime [\w-]+ \d+\. Page built \d{1,2} \w{3} \d{4}, \d\d:\d\d UTC from block [\d,]+\./.test(words)) fail(page, 'footer caption line')
  if (/href="[^"]*(?:\.rs|\/status\.json|\/posture\.json)"/.test(html.match(/<footer class="sc-footer"[\s\S]*?<\/footer>/)?.[0] ?? '')) fail(page, 'footer opens raw source or JSON')
  // the Ledger's chrome is gone (Appendix A 26–28)
  for (const gone of ['Read, then run', 'Last checked against the node', 'Snapshot drift', 'WATCH-LOG', 'Watch-log', 'checked against spec', 'Receipts', 'ON THIS PAGE', '⌘K', 'Nothing is logged at this address', 'nw-', 'polkadot.com/platform/sdk', 'Pulse', 'Observatory']) {
    if (html.includes(gone)) fail(page, `still carries "${gone}"`)
  }
  // one main landmark and one h1 in the prerendered page
  const mains = (html.match(/<main[\s>]/g) ?? []).length
  if (mains !== 1) fail(page, `${mains} main elements`)
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length
  if (h1 !== 1) fail(page, `${h1} h1 elements`)
}

const home = read('index.html')
if (!/<h1[^>]*>Documentation<\/h1>/.test(home)) fail('index.html', 'h1 is not "Documentation"')
const cards = [...home.matchAll(/<article class="sc-card"><h3>([^<]+)<\/h3>/g)].map((m) => m[1])
if (cards.join(', ') !== 'Run a node, Run an agent, Run a validator') fail('index.html', `cards are "${cards.join(', ')}"`)
const refList = home.match(/<ul class="sc-docs-list">([\s\S]*?)<\/ul>/)?.[1] ?? ''
for (const [label, href] of [['Constitution', '/docs/reference/constitution'], ['Token model', '/docs/reference/token-model'], ['Message privacy: what an operator can read', 'https://scalarnet.io/oversight']]) {
  if (!refList.includes(`href="${href}"`) || !refList.includes(label)) fail('index.html', `reference list lacks ${label} → ${href}`)
}
const homeMain = home.match(/<main[\s\S]*?<\/main>/)?.[0]
if (!homeMain) fail('index.html', 'no main')
else if (/\d/.test(text(homeMain))) fail('index.html', 'a hand-typed figure on the docs home')

// 404.html is a client-rendered shell (VitePress fills it in the browser);
// the plain 404 is held by theme/components/NotFound.vue and the layout check.
const nf = readFileSync(fileURLToPath(new URL('../.vitepress/theme/components/NotFound.vue', import.meta.url)), 'utf8')
if (!/<h1 class="sc-h1">Page not found<\/h1>/.test(nf)) fail('NotFound.vue', 'h1 is not "Page not found"')
if (!/There's nothing at/.test(nf)) fail('NotFound.vue', 'no sentence naming the path')
if (!/sc-docs-search-trigger/.test(nf)) fail('NotFound.vue', 'no search field')
if (/404|Nothing is logged|<noscript/.test(nf.replace(/^\/\/.*$/gm, ''))) fail('NotFound.vue', 'not plain: a 404 figure, the Ledger line or a scripts-off band')

const constitution = read('reference/constitution.html')
if (!constitution.includes('https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/pallets/constitution/src/lib.rs')) fail('reference/constitution.html', 'does not link the source')
const constitutionMain = constitution.match(/<main[\s\S]*?<\/main>/)?.[0]
if (!constitutionMain) fail('reference/constitution.html', 'no main')
else if (/\d/.test(text(constitutionMain.replace(/<footer class="sc-footer"[\s\S]*$/, '')))) fail('reference/constitution.html', 'a hand-typed figure')

for (const page of ['guide/run-a-validator.html', 'guide/testnet-tester-guide.html']) {
  if (!/<a href="\/docs\/chainspec\.json" download="chainspec\.json">chainspec\.json \(download\)<\/a>/.test(read(page))) fail(page, 'chain spec is not a download link labelled "chainspec.json (download)"')
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) in the built docs:\n  ${errors.join('\n  ')}`)
  process.exit(1)
}
console.log(`✓ built docs match the plain redesign: ${pages.length} pages checked (nav, footer, head, one h1, no Ledger chrome); home, 404, constitution and chain spec download as specified`)
