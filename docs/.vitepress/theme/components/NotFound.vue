<script setup lang="ts">
// The docs 404, plain (SITE-REDESIGN.md §5.4): the title, one sentence naming
// the path, two links (Home, Docs) and the docs search field, which opens
// VitePress's local search.
import { useData, withBase } from 'vitepress'
import { computed, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

const { theme } = useData()
const home = computed(() => `${theme.value.facts.site}/`)
const path = ref('')
onMounted(() => {
  path.value = location.pathname
})

function openSearch() {
  document.querySelector<HTMLButtonElement>('#local-search button')?.click()
}
</script>

<template>
  <main class="sc-container sc-docs-notfound">
    <h1 class="sc-h1">Page not found</h1>
    <p class="sc-lead">
      There's nothing at <span class="sc-docs-path">{{ path || 'this address' }}</span>.
    </p>
    <ul class="sc-row sc-docs-notfound-links">
      <li><a :href="home" target="_self">Home</a></li>
      <li><a :href="withBase('/')">Docs</a></li>
    </ul>
    <div class="sc-search sc-docs-search">
      <Icon name="search" />
      <button type="button" class="sc-input sc-docs-search-trigger" @click="openSearch">
        Search the docs
      </button>
    </div>
  </main>
</template>
