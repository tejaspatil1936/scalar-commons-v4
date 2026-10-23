<script setup lang="ts">
// The docs home (brief §5.4): eyebrow · title · one paragraph · the search
// field · three Readings · THE WATCH-LOG (the sidebar groups as a ledger),
// then index.md's own prose below.
import { Content, withBase } from 'vitepress'
import { inject } from 'vue'
import Reading from './Reading.vue'
import { formatInt, useFacts, useWatchLog } from '../ledger'

const facts = useFacts()
const { sidebar } = useWatchLog()
const openSearch = inject<() => void>('nw-open-search', () => {})
const ordinal = (i: number) => String(i + 1).padStart(2, '0')
</script>

<template>
  <div class="nw-frame nw-home">
    <header class="nw-home-head">
      <span class="nw-label nw-eyebrow">DOCUMENTATION · RUNTIME SPEC {{ facts.specVersion }}</span>
      <h1 class="nw-display">Read, then run.</h1>
      <p class="nw-body nw-dim">
        Everything an operator, an agent author or a validator needs, checked against the node it
        describes.
      </p>
      <button type="button" class="nw-field nw-search-field" @click="openSearch()">
        <span class="nw-search-placeholder">Search</span><span class="nw-tag nw-tag--kbd">⌘K</span>
      </button>
    </header>

    <div class="nw-row nw-home-readings">
      <Reading
        id="pages"
        label="Pages"
        :figure="formatInt(facts.pages)"
        size="m"
        :source="{ method: 'BUILD', url: 'docs/.vitepress/config.mts', block: facts.block }"
      />
      <Reading
        id="last-checked"
        label="Last checked against the node"
        :figure="`block ${formatInt(facts.block)}`"
        size="m"
        :source="{ method: 'FILE', url: 'docs/.chain/snapshot.json', block: facts.block }"
      />
      <Reading
        id="drift"
        label="Snapshot drift"
        :figure="formatInt(facts.drift)"
        unit="pages"
        size="m"
        :source="{
          method: 'BUILD',
          url: 'docs/scripts/check-chain-values.mjs',
          block: facts.block,
          computed: facts.checkPassed ? 'exit 0' : 'exit 1',
        }"
      />
    </div>

    <section class="nw-watchlog" aria-labelledby="nw-watchlog-label">
      <span id="nw-watchlog-label" class="nw-label">THE WATCH-LOG</span>
      <ol class="nw-watchlog-groups">
        <li v-for="(group, i) in sidebar" :key="group.text" class="nw-watchlog-group">
          <span class="nw-figure nw-figure--l nw-dim">{{ ordinal(i) }}</span>
          <div class="nw-watchlog-body">
            <div class="nw-reading-line">
              <h3 class="nw-h3">{{ group.text }}</h3>
              <span class="nw-leader" aria-hidden="true"></span>
              <span class="nw-figure nw-figure--m">{{ formatInt(group.items.length) }}</span>
            </div>
            <ul class="nw-watchlog-pages">
              <li v-for="item in group.items" :key="item.link">
                <a class="nw-quiet" :href="withBase(item.link)">{{ item.text }}</a>
              </li>
            </ul>
          </div>
        </li>
      </ol>
    </section>

    <div class="nw-prose nw-home-prose">
      <Content />
    </div>
  </div>
</template>
