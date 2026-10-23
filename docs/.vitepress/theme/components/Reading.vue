<script setup lang="ts">
// The chrome's `reading`: label · leader · figure · stub · receipt. A Reading
// without a source throws at render, so the build fails rather than ship a
// figure that names no origin. Everything on the docs is a record (sage).
import { computed, ref } from 'vue'
import { formatInt, requestLine, utc, type Source } from '../nightwatch'

const props = withDefaults(
  defineProps<{
    label: string
    figure: string
    size?: 'xl' | 'l' | 'm' | 'body'
    source: Source
    sub?: string | null
    id?: string
    stack?: boolean
    /** Wraps the figure in a link (templates.mjs `href`). */
    href?: string | null
    /** Renders the figure as a button that emits `activate` on a person's action (e.g. open search). */
    button?: boolean
  }>(),
  { size: 'm', sub: null, id: undefined, stack: false, href: null, button: false },
)
defineEmits<{ (e: 'activate'): void }>()

if (!props.source || !props.source.method || !props.source.url) {
  throw new Error(
    `Reading "${props.label}" has no source: every figure names its origin {method, url, fetchedAt, block, raw}`,
  )
}

const torn = ref(false)
const fetched = computed(() => (props.source.fetchedAt ? utc(props.source.fetchedAt) : '—'))
const blockWord = computed(() =>
  props.source.block === null || props.source.block === undefined
    ? '—'
    : `block ${formatInt(props.source.block)}`,
)
const blockSuffix = computed(() =>
  props.source.block === null || props.source.block === undefined
    ? ''
    : ` · block ${formatInt(props.source.block)}`,
)
</script>

<template>
  <div
    class="nw-reading"
    :class="{ 'is-torn': torn, 'nw-reading--stack': stack }"
    :data-reading="id"
    :id="id"
  >
    <div class="nw-reading-line">
      <span class="nw-label">{{ label }}</span>
      <span class="nw-leader" aria-hidden="true"></span>
      <span class="nw-reading-figure">
        <a v-if="href" :href="href" class="nw-figure-link">
          <span class="nw-figure" :class="`nw-figure--${size}`" data-reading-value>{{ figure }}</span>
        </a>
        <button v-else-if="button" type="button" class="nw-figure-button" @click="$emit('activate')">
          <span class="nw-figure" :class="`nw-figure--${size}`" data-reading-value>{{ figure }}</span>
        </button>
        <span v-else class="nw-figure" :class="`nw-figure--${size}`" data-reading-value>{{ figure }}</span>
        <button
          type="button"
          class="nw-stub"
          data-state="record"
          aria-label="RECORD · show the source"
          :aria-expanded="torn ? 'true' : 'false'"
          @click="torn = !torn"
        ></button>
      </span>
    </div>
    <p v-if="sub" class="nw-reading-sub" data-reading-sub>{{ sub }}</p>
    <span class="nw-receipt-line" data-receipt-line
      >{{ requestLine(source) }} · {{ fetched }}{{ blockSuffix }}</span
    >
    <div class="nw-receipt" data-receipt>
      <div data-request>{{ requestLine(source) }}</div>
      <div data-fetched>fetched {{ fetched }} · {{ blockWord }}</div>
      <div>
        <a v-if="source.raw" :href="source.raw" data-raw>raw ↗</a>
        <span v-else data-raw>raw —</span>
      </div>
      <div v-if="source.computed" data-computed>{{ source.computed }}</div>
    </div>
  </div>
</template>
