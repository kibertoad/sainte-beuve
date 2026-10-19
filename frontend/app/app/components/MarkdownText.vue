<script setup lang="ts">
// Markdown a model wrote, rendered without ever handing the page an HTML
// string. See `utils/markdown.ts`.
const props = defineProps<{ source: string }>()

const nodes = computed(() => renderMarkdown(props.source))
const Rendered = () => nodes.value
</script>

<template>
  <div class="space-y-2 break-words"><Rendered /></div>
</template>
