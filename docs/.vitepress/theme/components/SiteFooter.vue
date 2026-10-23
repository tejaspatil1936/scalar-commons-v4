<script setup lang="ts">
// The chrome's `footer`. Every fact is a record from docs/.chain/snapshot.json
// except builtAt, the build's own clock. Links to the landing are absolute
// because the docs are served under /docs/.
import { onMounted, onUnmounted } from 'vue'
import {
  DISCLAIMER,
  DOCS_URL,
  EXPLORER_ORIGIN,
  REPO_URL,
  SITE_ORIGIN,
  formatInt,
  useFacts,
  utc,
} from '../ledger'

const facts = useFacts()
const short = (hash: string) => `${String(hash).slice(0, 6)}…${String(hash).slice(-4)}`

const columns = [
  {
    head: 'Chain',
    links: [
      ['Observatory', `${SITE_ORIGIN}observatory`],
      ['Pulse', `${SITE_ORIGIN}pulse`],
      ['Explorer', EXPLORER_ORIGIN],
      ['Status', `${SITE_ORIGIN}status.json`],
    ],
  },
  {
    head: 'Build',
    links: [
      ['Docs', DOCS_URL],
      ['SDK', `${DOCS_URL}guide/sdk`],
      ['Faucet', `${SITE_ORIGIN}faucet`],
      ['GitHub', REPO_URL],
    ],
  },
  {
    head: 'Govern',
    links: [
      ['Constitution', `${REPO_URL}/blob/master/pallets/constitution/src/lib.rs`],
      ['Evidence', `${REPO_URL}/tree/master/evidence`],
      ['Changelog', `${REPO_URL}/releases`],
      ['Disclosures', `${SITE_ORIGIN}posture.json`],
    ],
  },
]

// print.css prints the URL and the time of printing from these attributes.
function stampPrintFoot() {
  const foot = document.querySelector<HTMLElement>('[data-print-foot]')
  if (!foot) return
  foot.setAttribute('data-url', location.href)
  foot.setAttribute('data-printed', utc(new Date().toISOString()) ?? '')
}
onMounted(() => window.addEventListener('beforeprint', stampPrintFoot))
onUnmounted(() => window.removeEventListener('beforeprint', stampPrintFoot))
</script>

<template>
  <footer class="nw-foot" data-footer>
    <div class="nw-frame nw-foot-inner">
      <div v-for="col in columns" :key="col.head" class="nw-foot-col">
        <span class="nw-label">{{ col.head }}</span>
        <a v-for="[label, href] in col.links" :key="label" :href="href">{{ label }}</a>
      </div>
      <div class="nw-foot-facts">
        <span>genesis {{ short(facts.genesisHash) }}</span>
        <span>spec {{ facts.specVersion }} · node {{ facts.nodeVersion ?? '—' }}</span>
        <span>site built {{ utc(facts.builtAt) ?? '—' }} against block {{ formatInt(facts.block) }}</span>
      </div>
      <p class="nw-foot-line">{{ DISCLAIMER }}</p>
      <p class="nw-print-foot" data-print-foot></p>
    </div>
  </footer>
</template>
