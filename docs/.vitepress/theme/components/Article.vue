<script setup lang="ts">
// An article: 240 px index · 640 px reading column · 240 px margin, inside
// 1200 px. Breadcrumb group › page, the title at --h2, the standfirst from
// frontmatter `description` when present, a receipt line on paper-2, the
// prose (margin notes float into the margin from `::: note` containers), a
// receipts footer from frontmatter `receipts:` as ledger rows (a 1 px rule
// between, the file:line behind a leader), and prev/next.
import { Content, onContentUpdated, useData, withBase } from 'vitepress'
import { computed, ref } from 'vue'
import { REPO_URL, formatInt, useFacts, useWatchLog } from '../ledger'

interface Header {
  level: number
  title: string
  link: string
}
interface ReceiptRow {
  claim: string
  file: string
  line: number | string
}

const { page, frontmatter } = useData()
const facts = useFacts()
const { sidebar, current, prev, next, isCurrent } = useWatchLog()

const headers = ref<Header[]>([])
onContentUpdated(() => {
  const root = document.querySelector('.nw-article-body')
  if (!root) {
    headers.value = []
    return
  }
  headers.value = Array.from(root.querySelectorAll<HTMLElement>('h2[id], h3[id]')).map((el) => ({
    level: Number(el.tagName.slice(1)),
    title: (el.textContent ?? '').replace(/\s*[​#]+\s*$/u, '').trim(),
    link: `#${el.id}`,
  }))
})

const receipts = computed<ReceiptRow[]>(() =>
  Array.isArray(frontmatter.value.receipts) ? frontmatter.value.receipts : [],
)
const receiptHref = (r: ReceiptRow) => `${REPO_URL}/blob/master/${r.file}#L${r.line}`
const group = computed(() => current.value?.group ?? '')
const sheetOpen = ref(false)
</script>

<template>
  <div class="nw-frame nw-article">
    <aside class="nw-index">
      <nav aria-label="Index">
        <div v-for="g in sidebar" :key="g.text" class="nw-index-group">
          <span class="nw-label">{{ g.text }}</span>
          <ul>
            <li v-for="item in g.items" :key="item.link">
              <a
                class="nw-mono"
                :href="withBase(item.link)"
                :aria-current="isCurrent(item) ? 'page' : undefined"
                >{{ item.text }}</a
              >
            </li>
          </ul>
        </div>
      </nav>
      <nav v-if="headers.length" class="nw-onpage" aria-label="On this page">
        <span class="nw-label">ON THIS PAGE</span>
        <ul>
          <li v-for="h in headers" :key="h.link" :class="`is-h${h.level}`">
            <a class="nw-mono" :href="h.link">{{ h.title }}</a>
          </li>
        </ul>
      </nav>
    </aside>

    <details v-if="headers.length" class="nw-onpage-sheet" :open="sheetOpen" @toggle="sheetOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="nw-label">ON THIS PAGE ▾</summary>
      <ul>
        <li v-for="h in headers" :key="h.link" :class="`is-h${h.level}`">
          <a class="nw-mono" :href="h.link" @click="sheetOpen = false">{{ h.title }}</a>
        </li>
      </ul>
    </details>

    <article class="nw-reading-col">
      <p class="nw-label nw-crumb">
        <span v-if="group">{{ group }}</span><span v-if="group"> › </span
        ><span>{{ page.title }}</span>
      </p>
      <h1 class="nw-h2 nw-article-title">{{ page.title }}</h1>
      <p v-if="frontmatter.description" class="nw-body nw-dim nw-standfirst">
        {{ frontmatter.description }}
      </p>
      <p class="nw-receipt-strip nw-mono">
        checked against spec {{ facts.specVersion }} · block {{ formatInt(facts.block) }} ·
        {{ formatInt(facts.drift) }} drift
      </p>

      <div class="nw-article-body nw-prose">
        <Content />
      </div>

      <footer class="nw-receipts-foot">
        <span class="nw-label">Receipts</span>
        <ul v-if="receipts.length" class="nw-receipt-rows">
          <li v-for="r in receipts" :key="`${r.file}:${r.line}`" class="nw-reading-line">
            <span class="nw-small">{{ r.claim }}</span>
            <span class="nw-leader" aria-hidden="true"></span>
            <a class="nw-mono" :href="receiptHref(r)">{{ r.file }}:{{ r.line }}</a>
          </li>
        </ul>
        <p class="nw-small nw-dim">
          npm run lint fails this page if any figure above drifts from the node snapshot.
        </p>
      </footer>

      <nav class="nw-prevnext" aria-label="Pages">
        <a v-if="prev" class="nw-quiet" :href="withBase(prev.link)">← {{ prev.text }}</a>
        <span v-else></span>
        <a v-if="next" class="nw-quiet" :href="withBase(next.link)">{{ next.text }} →</a>
      </nav>
    </article>

    <div class="nw-margin" aria-hidden="true"></div>
  </div>
</template>
