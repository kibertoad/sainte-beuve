<script setup lang="ts">
// What a screen shows while its first read is still in the air.
//
// It exists because the pages stopped AWAITING their data at setup. Suspense
// holds the previous screen until an awaited read resolves, so a click on Board
// used to sit on the workspace with nothing moving for two round trips and no
// sign that anything had been asked for. Read lazily, the page renders at once —
// and then has to say what it is waiting for, which is this.
//
// Deliberately the shape of the thing that is coming (a stack of cards, not a
// spinner in the middle of the screen), so the layout does not jump when the
// rows arrive.
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 })
</script>

<template>
  <div class="flex flex-col gap-3" aria-busy="true" aria-live="polite">
    <span class="sr-only">Loading</span>
    <UCard v-for="row in rows" :key="row">
      <div class="flex flex-col gap-3">
        <USkeleton class="h-5 w-1/3" />
        <USkeleton class="h-4 w-2/3" />
      </div>
    </UCard>
  </div>
</template>
