<script setup lang="ts">
// The phone menu's last row: GitHub, as in the chrome's menu panel.
import { useData } from 'vitepress'
import { computed } from 'vue'
import Icon from './Icon.vue'

const { theme } = useData()
const repo = computed(() => theme.value.facts.repo as string)
</script>

<template>
  <div class="sc-docs-screen-end">
    <a :href="repo" rel="noopener">GitHub<Icon name="external-link" small /></a>
  </div>
</template>
