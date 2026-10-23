<script setup lang="ts">
// The chrome's footer (landing/src/chrome/templates.mjs `footer`), same markup
// and class names: four link columns and one caption line. Links that leave
// the docs go to the site by full URL with target="_self", so VitePress's
// router lets the browser load them instead of looking for a docs page.
// Every figure in the caption is a record from docs/.chain/snapshot.json.
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import Icon from './Icon.vue'

const { theme } = useData()
const facts = computed(() => theme.value.facts)
const SITE = computed(() => facts.value.site as string)
const REPO = computed(() => facts.value.repo as string)

interface FooterLink {
  text: string
  href: string
  /** leaves the docs for a page on the site */
  site?: boolean
  /** another origin: the external-link icon and rel="noopener" */
  external?: boolean
}
const columns = computed<{ title: string; links: FooterLink[] }[]>(() => [
  {
    title: 'Product',
    links: [
      { text: 'Home', href: `${SITE.value}/`, site: true },
      { text: 'Network', href: `${SITE.value}/network`, site: true },
      { text: 'Explorer', href: 'https://explorer.scalarnet.io/', external: true },
      { text: 'Faucet', href: `${SITE.value}/faucet`, site: true },
    ],
  },
  {
    title: 'Developers',
    links: [
      { text: 'Docs', href: withBase('/') },
      { text: 'Run a node', href: withBase('/guide/run-a-node') },
      { text: 'Run an agent', href: withBase('/guide/run-an-agent') },
      { text: 'Run a validator', href: withBase('/guide/run-a-validator') },
      { text: 'SDK', href: withBase('/guide/sdk') },
      { text: 'Privacy demo', href: `${SITE.value}/oversight`, site: true },
    ],
  },
  {
    title: 'Project',
    links: [
      { text: 'GitHub', href: REPO.value, external: true },
      { text: 'Releases', href: `${REPO.value}/releases`, external: true },
      { text: 'Constitution', href: withBase('/reference/constitution') },
      { text: 'Security', href: `${REPO.value}/blob/master/SECURITY.md`, external: true },
    ],
  },
])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** An ISO instant → "23 Oct 2026, 11:32 UTC" (templates.mjs `formatUtc`). */
function formatUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
const formatInt = (n: number | string) => new Intl.NumberFormat('en-US').format(BigInt(n))

const line = computed(
  () =>
    `Testnet — tokens have no value and the chain may be reset. Runtime ${facts.value.specName} ${facts.value.specVersion}. ` +
    `Page built ${formatUtc(facts.value.builtAt)} from block ${formatInt(facts.value.block)}.`,
)
</script>

<template>
  <footer class="sc-footer">
    <div class="sc-container">
      <div class="sc-footer-cols">
        <div v-for="col in columns" :key="col.title" class="sc-footer-col">
          <h2>{{ col.title }}</h2>
          <ul>
            <li v-for="l in col.links" :key="l.text">
              <a
                :href="l.href"
                :target="l.site || l.external ? '_self' : undefined"
                :rel="l.external ? 'noopener' : undefined"
                >{{ l.text }}<Icon v-if="l.external" name="external-link" small
              /></a>
            </li>
          </ul>
        </div>
        <div class="sc-footer-col">
          <h2>Network</h2>
          <ul>
            <li class="sc-footer-value"><span>Public RPC</span><code>wss://rpc.scalarnet.io</code></li>
            <li class="sc-footer-value"><span>REST API</span><code>https://api.scalarnet.io/v1</code></li>
            <li>
              <a :href="withBase('/chainspec.json')" download="chainspec.json">Chain spec (download)</a>
            </li>
          </ul>
        </div>
      </div>
      <p class="sc-footer-line">{{ line }}</p>
    </div>
  </footer>
</template>
