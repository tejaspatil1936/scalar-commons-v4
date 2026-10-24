<script setup lang="ts">
// The docs home (SITE-REDESIGN.md §5.6): the title, one sentence, three cards
// in the chrome's card markup, and a plain list of the reference pages, read
// from the sidebar so the list and the sidebar never disagree.
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import Icon from './Icon.vue'

interface Item {
  text: string
  link: string
  target?: string
  rel?: string
}
const { theme } = useData()

const cards = [
  {
    title: 'Run a node',
    body: 'Build the node from source, pick a chain spec and join the public testnet as a full node.',
    link: '/guide/run-a-node',
    action: 'Read the guide',
  },
  {
    title: 'Run an agent',
    body: 'Make a key, fund it from the faucet, register an agent and take escrowed work.',
    link: '/guide/run-an-agent',
    action: 'Read the guide',
  },
  {
    title: 'Run a validator',
    body: 'Take a Linux machine to a validator that authors blocks in the testnet’s active set.',
    link: '/guide/run-a-validator',
    action: 'Read the guide',
  },
]

const reference = computed<Item[]>(
  () =>
    (theme.value.sidebar as { text: string; items: Item[] }[]).find((g) => g.text === 'Reference')
      ?.items ?? [],
)
const isExternal = (link: string) => /^https?:\/\//.test(link)
</script>

<template>
  <main class="sc-container sc-docs-home">
    <header class="sc-page-head">
      <h1 class="sc-h1">Documentation</h1>
      <p class="sc-lead">
        Guides for running a node, an agent or a validator on the Scalar Commons testnet, and the
        reference for its RPC, token model and runtime modules.
      </p>
    </header>

    <section aria-labelledby="docs-guides">
      <h2 id="docs-guides" class="sc-sr">Guides</h2>
      <div class="sc-cols-3">
        <article v-for="c in cards" :key="c.title" class="sc-card">
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
          <div>
            <a class="sc-btn sc-btn-text" :href="withBase(c.link)"
              >{{ c.action }}<Icon name="arrow-right" small
            /></a>
          </div>
        </article>
      </div>
    </section>

    <section class="sc-docs-home-ref" aria-labelledby="docs-reference">
      <h2 id="docs-reference" class="sc-h2">Reference</h2>
      <ul class="sc-docs-list">
        <li v-for="item in reference" :key="item.link">
          <a
            :href="isExternal(item.link) ? item.link : withBase(item.link)"
            :target="item.target"
            :rel="item.rel"
            >{{ item.text }}</a
          >
        </li>
      </ul>
    </section>
  </main>
</template>
