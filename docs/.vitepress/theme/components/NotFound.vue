<script setup lang="ts">
// The 404 slot (brief §5.8): `404` at --figure-xl dim, `Nothing is logged at
// this address.`, and three Readings, each with its source — the path a person
// asked for (filled in the browser from location.pathname, so it is `live`),
// the closest entry of the built route list by edit distance (the build's
// record; omitted when nothing is close), and the way out: the docs' local
// search, opened by the Reading or by ⌘K. The landing's /404 says the same in
// the same order (landing/src/notfound.mjs).
import { useData } from 'vitepress'
import { computed, inject, onMounted, ref } from 'vue'
import Reading from './Reading.vue'
import { useFacts } from '../ledger'

const { site } = useData()
const facts = useFacts()
const openSearch = inject<() => void>('nw-open-search', () => {})

const path = ref('')
const askedAt = ref<string | null>(null)
onMounted(() => {
  path.value = location.pathname
  askedAt.value = new Date().toISOString()
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

const base = computed(() => site.value.base.replace(/\/$/, ''))

/** The requested path without the site base, `.html` and a trailing slash, as the route list writes links. */
const asked = computed(() => {
  if (!path.value) return ''
  const p = path.value.startsWith(base.value) ? path.value.slice(base.value.length) : path.value
  return (p.replace(/\.html$/, '').replace(/\/$/, '') || '/').toLowerCase()
})

/** The nearest built route, or null when nothing is close: close means within a third of the route's length (at least 3 edits). */
const closest = computed(() => {
  if (!asked.value) return null
  let best: { route: string; d: number } | null = null
  for (const route of facts.value.routes ?? []) {
    const d = distance(asked.value, route.toLowerCase())
    if (!best || d < best.d) best = { route, d }
  }
  if (!best) return null
  const limit = Math.max(3, Math.floor(best.route.length / 3))
  return best.d <= limit ? best : null
})
/** The route as the reader would type it: under the base, the home with its trailing slash. */
const closestPath = computed(() =>
  closest.value ? (closest.value.route === '/' ? `${base.value}/` : `${base.value}${closest.value.route}`) : '',
)
</script>

<template>
  <section class="nw-frame nw-notfound">
    <span class="nw-figure nw-figure--xl nw-dim">404</span>
    <p class="nw-h3">Nothing is logged at this address.</p>
    <div class="nw-notfound-readings">
      <Reading
        id="asked-for"
        label="You asked for"
        :figure="path"
        size="body"
        state="live"
        :loading="!path"
        :source="{ method: 'CLIENT', url: 'location.pathname', fetchedAt: askedAt }"
      />
      <Reading
        v-if="closest"
        id="closest"
        label="Closest page"
        :figure="closestPath"
        size="body"
        :href="closestPath"
        :source="{
          method: 'BUILD',
          url: 'the built route list',
          fetchedAt: facts.builtAt,
          computed: `the nearest route by edit distance · ${closest.d} ${closest.d === 1 ? 'edit' : 'edits'}`,
        }"
      />
      <Reading
        id="search"
        label="Or"
        figure="search the docs · ⌘K"
        size="body"
        button
        :source="{ method: 'BUILD', url: 'the local search index', fetchedAt: facts.builtAt }"
        @activate="openSearch()"
      />
    </div>
  </section>
</template>
