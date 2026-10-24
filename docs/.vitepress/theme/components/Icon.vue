<script setup lang="ts">
// The chrome's icon set (landing/src/chrome/templates.mjs `icon`): 20 px,
// 1.5 px stroke, currentColor. Only the icons the docs theme draws.
const PATHS: Record<string, string> = {
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
  'external-link':
    '<path d="M11 4h5v5M16 4l-7 7M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  'arrow-right': '<path d="M4 10h12M11 5l5 5-5 5"/>',
}
const props = defineProps<{ name: 'search' | 'external-link' | 'arrow-right'; small?: boolean }>()
</script>

<template>
  <svg
    :class="['sc-icon', `sc-icon-${props.name}`, { 'sc-icon-sm': props.small }]"
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="PATHS[props.name]"
  />
</template>
