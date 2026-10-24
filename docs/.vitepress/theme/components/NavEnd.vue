<script setup lang="ts">
// The end of the nav bar, as in the chrome's header: a GitHub link (text and
// the external-link icon) and the one primary button, Get started.
import { useData, withBase } from 'vitepress'
import { computed } from 'vue'
import Icon from './Icon.vue'

const { theme } = useData()
const repo = computed(() => theme.value.facts.repo as string)
const getStarted = withBase('/guide/run-an-agent')
</script>

<template>
  <div class="sc-docs-navend">
    <a class="sc-header-link" :href="repo" rel="noopener" target="_self">GitHub<Icon name="external-link" small /></a>
    <a class="sc-btn sc-btn-primary" :href="getStarted">Get started</a>
  </div>
</template>
