<script setup lang="ts">
// The layer's root: a side rail of destinations, and the page beside it. A
// consuming deployment inherits this unless it ships its own.
const links = [
  { label: 'Reviews', to: '/', icon: 'i-lucide-git-pull-request' },
  { label: 'Reviewers', to: '/reviewers', icon: 'i-lucide-users' },
  { label: 'Configuration', to: '/configuration', icon: 'i-lucide-settings' },
]
</script>

<template>
  <UApp>
    <div class="min-h-screen flex">
      <aside class="w-56 shrink-0 border-r border-default flex flex-col gap-4 p-4">
        <span class="font-semibold px-2.5">sainte-beuve</span>
        <UNavigationMenu orientation="vertical" :items="links" />
      </aside>
      <main class="flex-1 min-w-0">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>
