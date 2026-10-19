<script setup lang="ts">
// The persona switch on a button that stays in the shell's header in both
// layouts, so it is one click away wherever the rail's own copy has scrolled to.
const auth = useAuthState()
const devMode = computed(() => auth.state.value?.devMode === true)
</script>

<template>
  <UModal v-if="devMode" title="Switch persona">
    <UButton
      icon="i-lucide-flask-conical"
      variant="ghost"
      color="warning"
      aria-label="Switch persona"
    />

    <template #body>
      <PersonaSwitcher />
    </template>
  </UModal>
</template>
