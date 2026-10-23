<script setup lang="ts">
// The chrome's `topBar` with current: 'docs'. The docs are static, so where a
// live page shows the lamp this bar shows a `built` Tag: AS BUILT · block n
// (the snapshot records a block, not a time). The Sources switch reveals the
// receipt lines (html[data-sources], remembered as `observatory:sources`);
// the ⌘K tag opens the local search.
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { NAV, SITE_NAME, SITE_ORIGIN, formatInt, useNightwatch } from '../nightwatch'

const facts = useNightwatch()
const openSearch = inject<() => void>('nw-open-search', () => {})
const scrolled = ref(false)
const open = ref(false)
const sources = ref(false)

const STORAGE_KEY = 'observatory:sources'
function applySources(on: boolean) {
  sources.value = on
  document.documentElement.toggleAttribute('data-sources', on)
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* storage may be unavailable; the switch still works for this page */
  }
}
function onScroll() {
  scrolled.value = window.scrollY > 8
}
onMounted(() => {
  let remembered = false
  try {
    remembered = localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    remembered = false
  }
  sources.value = remembered
  document.documentElement.toggleAttribute('data-sources', remembered)
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header class="nw-bar" data-bar :class="{ 'is-scrolled': scrolled, 'is-open': open }">
    <div class="nw-frame nw-bar-inner">
      <a class="nw-wordmark" :href="SITE_ORIGIN">{{ SITE_NAME }}</a>
      <nav class="nw-nav nw-label" aria-label="Site" id="nw-nav">
        <a
          v-for="item in NAV"
          :key="item.key"
          :href="item.href"
          :aria-current="item.key === 'docs' ? 'page' : undefined"
          >{{ item.label }}</a
        >
      </nav>
      <button
        type="button"
        class="nw-menu nw-label"
        :aria-expanded="open ? 'true' : 'false'"
        aria-controls="nw-nav"
        data-menu
        @click="open = !open"
      >
        <span>Docs</span><span>Menu</span>
      </button>
      <div class="nw-bar-right">
        <span class="nw-tag" data-state="built">AS BUILT<span class="nw-tag-detail"> · block {{ formatInt(facts.block) }}</span></span>
        <button
          type="button"
          class="nw-sources nw-label"
          role="switch"
          :aria-checked="sources ? 'true' : 'false'"
          data-sources-switch
          @click="applySources(!sources)"
        >
          <span class="nw-sources-word">Sources</span><span class="nw-switch" aria-hidden="true"></span>
        </button>
        <span
          class="nw-tag nw-tag--kbd"
          data-palette-open
          role="button"
          tabindex="0"
          @click="openSearch()"
          @keydown.enter.prevent="openSearch()"
          @keydown.space.prevent="openSearch()"
          >⌘K</span
        >
      </div>
    </div>
    <nav class="nw-nav-row nw-label" aria-label="Site, small screens">
      <a
        v-for="item in NAV"
        :key="item.key"
        :href="item.href"
        :aria-current="item.key === 'docs' ? 'page' : undefined"
        >{{ item.label }}</a
      >
    </nav>
  </header>
</template>
