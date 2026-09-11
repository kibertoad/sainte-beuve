<script setup lang="ts">
// The one way a failed fetch is shown.
//
// Three treatments had grown across five screens: two hardcoded "Is the backend
// running?", which is the wrong question when the API answered and broke its
// contract, and two rendered nothing at all, so the screen claimed its list was
// empty when it had simply failed to read it.
//
// The title says what could not be read, because that is what the screen knows.
// The description is the error's own message, because that is what distinguishes
// unreachable from refused from answered-something-unexpected.
defineProps<{
  error: unknown
  title: string
}>()
</script>

<template>
  <UAlert color="error" variant="subtle" :title="title" :description="apiErrorMessage(error)" />
</template>
