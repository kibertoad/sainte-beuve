<script setup lang="ts">
// The layer's root. A consuming deployment inherits this unless it ships its own.
const links = [
  { label: 'Reviews', to: '/', icon: 'i-lucide-git-pull-request' },
  { label: 'Reviewers', to: '/reviewers', icon: 'i-lucide-users' },
]
</script>

<template>
  <UApp>
    <header class="border-b border-default">
      <UContainer class="flex items-center gap-6 py-3">
        <span class="font-semibold">sainte-beuve</span>
        <UNavigationMenu :items="links" />
      </UContainer>
    </header>
    <NuxtPage />
  </UApp>
</template>
