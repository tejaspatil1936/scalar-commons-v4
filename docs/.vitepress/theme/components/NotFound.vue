<script setup lang="ts">
// The 404 slot (brief §5.8): `404` at --figure-xl dim, `Nothing is logged at
// this address.`, and three Readings — the path a person asked for (filled
// client-side from location.pathname), the closest page of the built route
// list by edit distance (omitted when nothing is close), and the search.
import { useData } from 'vitepress'
import { computed, inject, onMounted, ref } from 'vue'
import Reading from './Reading.vue'
import { useWatchLog } from '../nightwatch'

const { site } = useData()
const { flat } = useWatchLog()
const openSearch = inject<() => void>('nw-open-search', () => {})

const path = ref('')
onMounted(() => {
  path.value = location.pathname
})

/** Levenshtein distance between two strings. */
function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

/** The requested path without the site base, `.html` and a trailing slash, as the route list writes links. */
const asked = computed(() => {
  if (!path.value) return ''
  const base = site.value.base.replace(/\/$/, '')
  const p = path.value.startsWith(base) ? path.value.slice(base.length) : path.value
  return (p.replace(/\.html$/, '').replace(/\/$/, '') || '/').toLowerCase()
})

/** The nearest route, or null when nothing is close: close means within a third of the route's length (at least 3 edits). */
const closest = computed(() => {
  if (!asked.value) return null
  let best: { link: string; text: string; d: number } | null = null
  for (const page of flat.value) {
    const d = distance(asked.value, page.link.toLowerCase())
    if (!best || d < best.d) best = { link: page.link, text: page.text, d }
  }
  if (!best) return null
  const limit = Math.max(3, Math.floor(best.link.length / 3))
  return best.d <= limit ? best : null
})

const base = computed(() => site.value.base.replace(/\/$/, ''))
</script>

<template>
  <section class="nw-frame nw-notfound">
    <span class="nw-figure nw-figure--xl nw-sage">404</span>
    <p class="nw-body">Nothing is logged at this address.</p>
    <div class="nw-notfound-readings">
      <Reading
        id="asked-for"
        label="You asked for"
        :figure="path"
        size="body"
        :source="{ method: 'CLIENT', url: 'location.pathname' }"
      />
      <Reading
        v-if="closest"
        id="closest"
        label="Closest page"
        :figure="closest.text"
        size="body"
        :href="`${base}${closest.link}`"
        :source="{ method: 'BUILD', url: 'the built route list', computed: `edit distance ${closest.d}` }"
      />
      <Reading
        id="search"
        label="Or"
        figure="search the docs · ⌘K"
        size="body"
        button
        :source="{ method: 'BUILD', url: 'docs/.vitepress/config.mts' }"
        @activate="openSearch()"
      />
    </div>
  </section>
</template>
