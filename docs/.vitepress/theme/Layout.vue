<script setup lang="ts">
// The frame: the chrome's top bar, the page (home, article or the 404 slot),
// the chrome's footer, and VitePress's local search sheet, opened by the ⌘K
// tag, the home search field or the key itself.
import { useData } from 'vitepress'
import { defineAsyncComponent, onMounted, onUnmounted, provide, ref } from 'vue'
import TopBar from './components/TopBar.vue'
import SiteFooter from './components/SiteFooter.vue'
import Home from './components/Home.vue'
import Article from './components/Article.vue'

const VPLocalSearchBox = defineAsyncComponent(
  () => import('vitepress/dist/client/theme-default/components/VPLocalSearchBox.vue'),
)

const { frontmatter, page } = useData()
const searchOpen = ref(false)
const openSearch = () => {
  searchOpen.value = true
}
provide('nw-open-search', openSearch)

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = !searchOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <TopBar />
  <main id="nw-main" class="nw-main">
    <Home v-if="frontmatter.layout === 'home'" />
    <section v-else-if="page.isNotFound" class="nw-frame nw-notfound">
      <span class="nw-figure nw-figure--xl nw-sage">404</span>
      <p class="nw-body">Nothing is logged at this address.</p>
    </section>
    <Article v-else />
  </main>
  <SiteFooter />
  <ClientOnly>
    <VPLocalSearchBox v-if="searchOpen" @close="searchOpen = false" />
  </ClientOnly>
</template>
